import type { ArtifactTaskBinding } from '../services/agent/turn-task-context.ts'
import { canonicalJson } from '../../shared/utils/canonical-json.ts'
import { normalizeArtifact } from '../../shared/artifacts/normalize.ts'
import { withTransaction, type SyncCallback } from '../db/transaction.ts'
import { isSqliteBusyError } from '../db/sqlite-error.ts'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type {
  Artifact,
  ArtifactActor,
  ArtifactEvent,
  ArtifactExportEvent
} from '../../shared/artifacts/types.ts'
import {
  artifactBusyError,
  ArtifactConflictError,
  ArtifactIntegrityError
} from '../errors/artifacts.ts'

export interface ArtifactReservation {
  artifact: Artifact
  fileName: string
  tempName: string
  actor: ArtifactActor
  taskBinding?: ArtifactTaskBinding
  callerCommit?: boolean
}

export interface ArtifactOperation {
  requestId: string
  kind: 'create' | 'metadata'
  payloadHash: string
  artifactId: string
  data: ArtifactReservation
  state: 'pending' | 'awaiting_retry' | 'failed' | 'committed'
}

interface OperationRow {
  request_id: string
  kind: ArtifactOperation['kind']
  payload_hash: string
  artifact_id: string
  data_json: string
  state: ArtifactOperation['state']
}

export class ArtifactCatalogRepository {
  onMetadata?: (artifact: Artifact) => void
  readonly storeId: string
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync, root: string, namespace: string) {
    this.db = db
    this.storeId = this.transaction(() => {
      const found = db
        .prepare(
          'SELECT id FROM artifact_stores WHERE canonical_root=? AND db_namespace=?'
        )
        .get(root, namespace) as { id: string } | undefined
      if (found) return found.id
      // A stopped backup keeps its identity when restored with its database.
      const main = (
        db.prepare('PRAGMA database_list').all() as {
          name: string
          file: string
        }[]
      ).find(database => database.name === 'main')
      if (main?.file === join(root, '.githuman', `${namespace}reviews.db`)) {
        const stores = db
          .prepare('SELECT id FROM artifact_stores WHERE db_namespace=?')
          .all(namespace) as { id: string }[]
        if (stores.length > 1) {
          throw new ArtifactConflictError('Ambiguous restored artifact store.')
        }
        if (stores[0]) return stores[0].id
      }
      const id = randomUUID()
      db.prepare('INSERT INTO artifact_stores VALUES(?,?,?,1)').run(
        id,
        root,
        namespace
      )
      db.prepare('INSERT INTO artifact_store_epochs VALUES(?,0)').run(id)
      return id
    })
  }

  transaction<T>(run: SyncCallback<T>): T {
    return this.runTransaction(run, 'immediate')
  }

  readSnapshot<T>(run: SyncCallback<T>): T {
    return this.runTransaction(run, 'deferred')
  }

  private runTransaction<T>(
    run: SyncCallback<T>,
    mode: 'deferred' | 'immediate'
  ): T {
    try {
      return withTransaction(this.db, run, { mode })
    } catch (error) {
      if (isSqliteBusyError(error)) {
        throw artifactBusyError(
          'Artifact database is busy. Retry the operation.'
        )
      }
      throw error
    }
  }

  epoch(): number {
    const row = this.db
      .prepare('SELECT store_epoch FROM artifact_store_epochs WHERE store_id=?')
      .get(this.storeId) as { store_epoch: number } | undefined
    return row?.store_epoch ?? 0
  }

  validationEpoch(): number {
    return (
      this.db
        .prepare(
          'SELECT COALESCE(MAX(seq),0) epoch FROM artifact_store_changes WHERE store_id=? AND validation_relevant=1'
        )
        .get(this.storeId) as { epoch: number }
    ).epoch
  }

  get(id: string): Artifact | undefined {
    const row = this.db
      .prepare(
        'SELECT snapshot_json FROM artifact_current WHERE store_id=? AND artifact_id=?'
      )
      .get(this.storeId, id) as { snapshot_json: string } | undefined
    return row
      ? normalizeArtifact(JSON.parse(row.snapshot_json) as Artifact)
      : undefined
  }

  /** Artifacts that list the task, read through the task index. */
  artifactsOfTask(taskId: string): Artifact[] {
    const rows = this.db
      .prepare(`SELECT c.snapshot_json FROM artifact_task_links l
      JOIN artifact_current c ON c.store_id=l.store_id AND c.artifact_id=l.artifact_id
      WHERE l.store_id=? AND l.task_id=? ORDER BY l.artifact_id`)
      .all(this.storeId, taskId) as { snapshot_json: string }[]
    return rows.map(row =>
      normalizeArtifact(JSON.parse(row.snapshot_json) as Artifact)
    )
  }

  list(limit: number, after?: { createdAt: string; id: string }): Artifact[] {
    const rows = this.db
      .prepare(`SELECT c.snapshot_json FROM artifact_current c
      JOIN artifacts a ON a.store_id=c.store_id AND a.id=c.artifact_id
      WHERE c.store_id=? AND (? IS NULL OR (a.created_at,a.id)>(?,?))
      ORDER BY a.created_at,a.id LIMIT ?`)
      .all(
        this.storeId,
        after?.id ?? null,
        after?.createdAt ?? '',
        after?.id ?? '',
        limit
      ) as { snapshot_json: string }[]
    return rows.map(row =>
      normalizeArtifact(JSON.parse(row.snapshot_json) as Artifact)
    )
  }

  eventSequence(): number {
    return (
      this.db
        .prepare(
          'SELECT COALESCE(MAX(seq),0) seq FROM artifact_events WHERE store_id=?'
        )
        .get(this.storeId) as { seq: number }
    ).seq
  }

  assertExportHistory(id: string, snapshotSeq: number): void {
    const missing = this.db
      .prepare(`SELECT e.seq FROM artifact_events e
      LEFT JOIN artifact_metadata_versions v
      ON v.store_id=e.store_id AND v.artifact_id=e.artifact_id AND v.version=json_extract(e.data_json,'$.afterVersion')
      WHERE e.store_id=? AND e.artifact_id=? AND e.seq<=? AND v.version IS NULL LIMIT 1`)
      .get(this.storeId, id, snapshotSeq)
    if (missing) {
      throw new ArtifactIntegrityError('Artifact history version is missing.')
    }
  }

  exportHistory(
    id: string,
    afterSeq: number,
    snapshotSeq: number,
    limit: number
  ): ArtifactExportEvent[] {
    const rows = this.db
      .prepare(`SELECT e.seq,e.data_json,v.snapshot_json
      FROM artifact_events e LEFT JOIN artifact_metadata_versions v
      ON v.store_id=e.store_id AND v.artifact_id=e.artifact_id AND v.version=json_extract(e.data_json,'$.afterVersion')
      WHERE e.store_id=? AND e.artifact_id=? AND e.seq>? AND e.seq<=?
      ORDER BY e.seq LIMIT ?`)
      .all(this.storeId, id, afterSeq, snapshotSeq, limit) as {
      seq: number
      data_json: string
      snapshot_json: string | null
    }[]
    return rows.map(row => {
      if (row.snapshot_json === null) {
        throw new ArtifactIntegrityError('Artifact history version is missing.')
      }
      return {
        ...(JSON.parse(row.data_json) as Omit<ArtifactEvent, 'seq'>),
        seq: row.seq,
        snapshot: normalizeArtifact(JSON.parse(row.snapshot_json) as Artifact)
      }
    })
  }

  history(id: string, afterSeq: number, limit: number): ArtifactEvent[] {
    const rows = this.db
      .prepare(
        'SELECT seq,data_json FROM artifact_events WHERE store_id=? AND artifact_id=? AND seq>? ORDER BY seq LIMIT ?'
      )
      .all(this.storeId, id, afterSeq, limit) as {
      seq: number
      data_json: string
    }[]
    return rows.map(row => ({
      ...(JSON.parse(row.data_json) as Omit<ArtifactEvent, 'seq'>),
      seq: row.seq
    }))
  }

  operation(requestId: string): ArtifactOperation | undefined {
    const row = this.db
      .prepare(`SELECT o.*, (SELECT state FROM artifact_operation_events e
      WHERE e.store_id=o.store_id AND e.request_id=o.request_id ORDER BY e.seq DESC LIMIT 1) state
      FROM artifact_operations o WHERE o.store_id=? AND o.request_id=?`)
      .get(this.storeId, requestId) as OperationRow | undefined
    return row
      ? {
          requestId: row.request_id,
          kind: row.kind,
          payloadHash: row.payload_hash,
          artifactId: row.artifact_id,
          data: JSON.parse(row.data_json) as ArtifactReservation,
          state: row.state
        }
      : undefined
  }

  operations(includeCommitted = true): ArtifactOperation[] {
    const rows = this.db
      .prepare(
        `SELECT request_id FROM artifact_operations o WHERE store_id=? AND kind=? AND (? OR (SELECT state FROM artifact_operation_events e WHERE e.store_id=o.store_id AND e.request_id=o.request_id ORDER BY e.seq DESC LIMIT 1) IN ('pending','awaiting_retry')) ORDER BY rowid`
      )
      .all(this.storeId, 'create', Number(includeCommitted)) as {
      request_id: string
    }[]
    return rows.map(row => this.operation(row.request_id)!)
  }

  reserve(operation: Omit<ArtifactOperation, 'state'>, now: string): void {
    this.db
      .prepare('INSERT INTO artifact_operations VALUES(?,?,?,?,?,?)')
      .run(
        this.storeId,
        operation.requestId,
        operation.kind,
        operation.payloadHash,
        operation.artifactId,
        JSON.stringify(operation.data)
      )
    this.transition(operation.requestId, 'pending', now)
  }

  transition(
    requestId: string,
    state: ArtifactOperation['state'],
    now: string
  ): void {
    this.db
      .prepare(
        'INSERT INTO artifact_operation_events(store_id,request_id,state,created_at) VALUES(?,?,?,?)'
      )
      .run(this.storeId, requestId, state, now)
  }

  claim(requestId: string, owner: string, now: number, ttl: number): void {
    const lease = this.db
      .prepare(
        'SELECT owner,expires_at FROM artifact_operation_leases WHERE store_id=? AND request_id=?'
      )
      .get(this.storeId, requestId) as
      | { owner: string; expires_at: number }
      | undefined
    if (lease && lease.owner !== owner && lease.expires_at > now) {
      throw new ArtifactConflictError('Artifact operation is in progress.')
    }
    this.db
      .prepare(`INSERT INTO artifact_operation_leases VALUES(?,?,?,?)
      ON CONFLICT(store_id,request_id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at`)
      .run(this.storeId, requestId, owner, now + ttl)
  }

  assertOwner(requestId: string, owner: string, now: number): void {
    const row = this.db
      .prepare(
        'SELECT owner,expires_at FROM artifact_operation_leases WHERE store_id=? AND request_id=?'
      )
      .get(this.storeId, requestId) as
      | { owner: string; expires_at: number }
      | undefined
    if (!row || row.owner !== owner || row.expires_at <= now) {
      throw new ArtifactConflictError('Artifact operation lease expired.')
    }
  }

  release(requestId: string, owner: string): void {
    this.db
      .prepare(
        'DELETE FROM artifact_operation_leases WHERE store_id=? AND request_id=? AND owner=?'
      )
      .run(this.storeId, requestId, owner)
  }

  insertArtifact(data: ArtifactReservation): void {
    const a = data.artifact
    this.db
      .prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?,?)')
      .run(
        this.storeId,
        a.id,
        data.fileName,
        a.sha256,
        a.bytes,
        a.bodyStartLine,
        a.createdAt
      )
  }

  appendMetadata(
    artifact: Artifact,
    requestId: string,
    actor: ArtifactActor,
    action: ArtifactEvent['action']
  ): void {
    const previous = this.get(artifact.id)
    const event: Omit<ArtifactEvent, 'seq'> = {
      storeId: this.storeId,
      artifactId: artifact.id,
      requestId,
      actor,
      action,
      beforeVersion:
        artifact.metadataVersion === 1 ? null : artifact.metadataVersion - 1,
      afterVersion: artifact.metadataVersion,
      createdAt: artifact.metadataUpdatedAt,
      metadata: {
        title: artifact.title,
        ...(artifact.sourcePath === undefined
          ? {}
          : { sourcePath: artifact.sourcePath }),
        tags: artifact.tags,
        typeId: artifact.typeId,
        taskIds: artifact.taskIds,
        relations: artifact.relations
      }
    }
    const snapshot = JSON.stringify(artifact)
    this.db
      .prepare('INSERT INTO artifact_metadata_versions VALUES(?,?,?,?,?)')
      .run(
        this.storeId,
        artifact.id,
        artifact.metadataVersion,
        requestId,
        snapshot
      )
    this.db
      .prepare(
        'INSERT INTO artifact_events(store_id,artifact_id,request_id,data_json) VALUES(?,?,?,?)'
      )
      .run(this.storeId, artifact.id, requestId, JSON.stringify(event))
    this.db
      .prepare(`INSERT INTO artifact_current VALUES(?,?,?,?) ON CONFLICT(store_id,artifact_id)
      DO UPDATE SET version=excluded.version,snapshot_json=excluded.snapshot_json`)
      .run(this.storeId, artifact.id, artifact.metadataVersion, snapshot)
    const relevant = previous
      ? canonicalJson([
          previous.status,
          previous.typeId,
          previous.taskIds,
          previous.relations,
          previous.revisionOf
        ]) !==
        canonicalJson([
          artifact.status,
          artifact.typeId,
          artifact.taskIds,
          artifact.relations,
          artifact.revisionOf
        ])
      : artifact.status !== 'draft' ||
        artifact.taskIds.length > 0 ||
        artifact.relations.length > 0 ||
        artifact.revisionOf.length > 0
    this.recordChange('artifact', artifact.id, requestId, relevant)
    this.onMetadata?.(artifact)
  }

  recordChange(
    kind: string,
    id: string,
    requestId: string,
    validationRelevant = true
  ): void {
    const inserted = this.db
      .prepare(
        'INSERT INTO artifact_store_changes(store_id,entity_kind,entity_id,request_id,validation_relevant) VALUES(?,?,?,?,?)'
      )
      .run(this.storeId, kind, id, requestId, Number(validationRelevant))
    this.db
      .prepare(
        'UPDATE artifact_store_epochs SET store_epoch=? WHERE store_id=?'
      )
      .run(Number(inserted.lastInsertRowid), this.storeId)
  }

  supersededArtifactIds(): Set<string> {
    const rows = this.db
      .prepare(`SELECT DISTINCT artifact_id FROM artifact_metadata_versions
        WHERE store_id=? AND json_extract(snapshot_json, '$.status')='superseded'`)
      .all(this.storeId) as { artifact_id: string }[]
    return new Set(rows.map(row => row.artifact_id))
  }

  all(): Artifact[] {
    return (
      this.db
        .prepare(
          'SELECT snapshot_json FROM artifact_current WHERE store_id=? ORDER BY artifact_id'
        )
        .all(this.storeId) as { snapshot_json: string }[]
    ).map(row => normalizeArtifact(JSON.parse(row.snapshot_json) as Artifact))
  }

  rebuild(): void {
    this.transaction(() => {
      this.db
        .prepare('DELETE FROM artifact_current WHERE store_id=?')
        .run(this.storeId)
      this.db
        .prepare(`INSERT INTO artifact_current SELECT v.store_id,v.artifact_id,v.version,v.snapshot_json
        FROM artifact_metadata_versions v WHERE v.store_id=? AND v.version=(SELECT MAX(n.version)
        FROM artifact_metadata_versions n WHERE n.store_id=v.store_id AND n.artifact_id=v.artifact_id)`)
        .run(this.storeId)
      this.db
        .prepare(`INSERT INTO artifact_store_epochs VALUES(?,(SELECT COALESCE(MAX(seq),0) FROM artifact_store_changes WHERE store_id=?))
        ON CONFLICT(store_id) DO UPDATE SET store_epoch=excluded.store_epoch`)
        .run(this.storeId, this.storeId)
    })
  }
}
