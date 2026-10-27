import type { DatabaseSync } from 'node:sqlite'
import type { ArtifactActor } from '../../shared/artifacts/types.ts'
import type { Task, ArtifactType } from '../../shared/tasks/types.ts'
import { ArtifactConflictError } from '../errors/artifacts.ts'

export type Definition = Task | ArtifactType
export interface DefinitionEvent<T> {
  snapshot: T
  requestId: string
  actor: ArtifactActor
  createdAt: string
}

export class TaskRepository {
  readonly db: DatabaseSync
  readonly storeId: string
  constructor(db: DatabaseSync, storeId: string) {
    this.db = db
    this.storeId = storeId
  }

  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- The caller supplies the domain type for stored JSON.
  get<T extends Definition>(
    kind: 'task' | 'artifact_type',
    id: string
  ): T | undefined {
    const row = this.db
      .prepare(
        `SELECT snapshot_json FROM ${kind}_current WHERE store_id=? AND id=?`
      )
      .get(this.storeId, id) as { snapshot_json: string } | undefined
    return row ? (JSON.parse(row.snapshot_json) as T) : undefined
  }
  all<T extends Definition>(kind: 'task' | 'artifact_type'): T[] {
    return (
      this.db
        .prepare(
          `SELECT snapshot_json FROM ${kind}_current WHERE store_id=? ORDER BY id`
        )
        .all(this.storeId) as { snapshot_json: string }[]
    ).map(row => JSON.parse(row.snapshot_json) as T)
  }
  history<T extends Definition>(
    kind: 'task' | 'artifact_type',
    id: string
  ): DefinitionEvent<T>[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM ${kind}_versions WHERE store_id=? AND id=? ORDER BY version`
        )
        .all(this.storeId, id) as {
        snapshot_json: string
        request_id: string
        actor_json: string
        created_at: string
      }[]
    ).map(row => ({
      snapshot: JSON.parse(row.snapshot_json) as T,
      requestId: row.request_id,
      actor: JSON.parse(row.actor_json) as ArtifactActor,
      createdAt: row.created_at
    }))
  }
  append(
    kind: 'task' | 'artifact_type',
    snapshot: Definition,
    requestId: string,
    actor: ArtifactActor,
    now: string
  ): void {
    this.db
      .prepare(`INSERT INTO ${kind}_versions VALUES(?,?,?,?,?,?,?)`)
      .run(
        this.storeId,
        snapshot.id,
        snapshot.version,
        requestId,
        JSON.stringify(snapshot),
        JSON.stringify(actor),
        now
      )
    this.db
      .prepare(
        `INSERT INTO ${kind}_current VALUES(?,?,?) ON CONFLICT(store_id,id) DO UPDATE SET snapshot_json=excluded.snapshot_json`
      )
      .run(this.storeId, snapshot.id, JSON.stringify(snapshot))
  }
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- The command owner knows the stored result type.
  replay<T>(requestId: string, hash: string): { result: T } | undefined {
    if (
      this.db
        .prepare(
          'SELECT 1 FROM artifact_operations WHERE store_id=? AND request_id=?'
        )
        .get(this.storeId, requestId)
    ) {
      throw new ArtifactConflictError(
        'Request identifier already used for an artifact operation.'
      )
    }
    const row = this.db
      .prepare(
        'SELECT payload_hash,result_json FROM artifact_definition_operations WHERE store_id=? AND request_id=?'
      )
      .get(this.storeId, requestId) as
      | { payload_hash: string; result_json: string }
      | undefined
    if (!row) {
      const reserved = this.db
        .prepare(
          'SELECT 1 FROM artifact_type_versions WHERE store_id=? AND request_id=?'
        )
        .get(this.storeId, requestId)
      if (reserved) {
        throw new ArtifactConflictError(
          'Request identifier belongs to type initialization.'
        )
      }
      return undefined
    }
    if (row.payload_hash !== hash) {
      throw new ArtifactConflictError(
        'Request identifier already used for a different operation.'
      )
    }
    return { result: JSON.parse(row.result_json) as T }
  }
  record(requestId: string, hash: string, result: unknown): void {
    this.db
      .prepare('INSERT INTO artifact_definition_operations VALUES(?,?,?,?)')
      .run(this.storeId, requestId, hash, JSON.stringify(result))
  }
  assertArtifactRequest(requestId: string): void {
    if (
      this.db
        .prepare(
          'SELECT 1 FROM artifact_definition_operations WHERE store_id=? AND request_id=?'
        )
        .get(this.storeId, requestId)
    ) {
      throw new ArtifactConflictError(
        'Request identifier already used for a definition operation.'
      )
    }
  }
  assignment(sessionId: string): {
    sessionId: string
    version: number
    taskIds: string[]
  } {
    const row = this.db
      .prepare(
        'SELECT version,task_ids_json FROM task_chat_link_events WHERE store_id=? AND session_id=? ORDER BY version DESC LIMIT 1'
      )
      .get(this.storeId, sessionId) as
      | { version: number; task_ids_json: string }
      | undefined
    return {
      sessionId,
      version: row?.version ?? 0,
      taskIds: row ? (JSON.parse(row.task_ids_json) as string[]) : []
    }
  }
  appendAssignment(
    sessionId: string,
    version: number,
    taskIds: string[],
    title: string,
    requestId: string,
    actor: ArtifactActor,
    now: string
  ): void {
    this.db
      .prepare(
        'INSERT INTO task_chat_link_events(store_id,session_id,version,request_id,task_ids_json,chat_title_snapshot,actor_json,created_at) VALUES(?,?,?,?,?,?,?,?)'
      )
      .run(
        this.storeId,
        sessionId,
        version,
        requestId,
        JSON.stringify(taskIds),
        title,
        JSON.stringify(actor),
        now
      )
  }
  chatHistory() {
    return (
      this.db
        .prepare(
          'SELECT * FROM task_chat_link_events WHERE store_id=? ORDER BY seq'
        )
        .all(this.storeId) as {
        seq: number
        session_id: string
        version: number
        task_ids_json: string
        chat_title_snapshot: string
        actor_json: string
        created_at: string
        request_id: string
      }[]
    ).map(row => ({
      seq: row.seq,
      sessionId: row.session_id,
      version: row.version,
      taskIds: JSON.parse(row.task_ids_json) as string[],
      title: row.chat_title_snapshot,
      actor: JSON.parse(row.actor_json) as ArtifactActor,
      createdAt: row.created_at,
      requestId: row.request_id
    }))
  }
  rebuild(): void {
    for (const kind of ['task', 'artifact_type'] as const) {
      this.db
        .prepare(`DELETE FROM ${kind}_current WHERE store_id=?`)
        .run(this.storeId)
      this.db
        .prepare(
          `INSERT INTO ${kind}_current SELECT v.store_id,v.id,v.snapshot_json FROM ${kind}_versions v WHERE v.store_id=? AND v.version=(SELECT MAX(n.version) FROM ${kind}_versions n WHERE n.store_id=v.store_id AND n.id=v.id)`
        )
        .run(this.storeId)
    }
  }
}
