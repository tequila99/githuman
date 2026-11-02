import type { DatabaseSync } from 'node:sqlite'
import type {
  Artifact,
  ArtifactHistoricalChangeSet,
  ArtifactValidationReport,
  ArtifactStoredChangeSet
} from '../../shared/artifacts/types.ts'
import {
  artifactLeaseBusyError,
  ArtifactNotFoundError
} from '../errors/artifacts.ts'

export type StoredChangeSet = ArtifactStoredChangeSet
export interface ValidationManifest {
  rulesVersion: number
  validationEpoch: number
  changeDigest: string
  changeSet: ArtifactHistoricalChangeSet
  artifacts: Artifact[]
  requiredContentIds: string[]
}
export interface StoredValidation {
  id: string
  changeSetId: string
  version: number
  manifest: ValidationManifest
  manifestDigest: string
  state:
    | 'prepared'
    | 'running'
    | 'pass'
    | 'conflict'
    | 'incomplete'
    | 'cancelled'
  validatorSessionId: string | null
  owner: string | null
  expiresAt: number | null
  report?: ArtifactValidationReport & {
    manifestDigest: string
    changeDigest: string
    validatorSessionId: string
    reportArtifactId?: string
  }
  reason?: string
  submissionDigest?: string
  eventKind?: string
  readCoverage?: { key: string; bytes: number }[]
}

export class ArtifactValidationRepository {
  private readonly db: DatabaseSync
  readonly storeId: string
  constructor(db: DatabaseSync, storeId: string) {
    this.db = db
    this.storeId = storeId
  }

  proposal(id: string): StoredChangeSet {
    const row = this.db
      .prepare(
        'SELECT payload_json FROM artifact_change_set_events WHERE store_id=? AND id=? ORDER BY version DESC LIMIT 1'
      )
      .get(this.storeId, id) as { payload_json: string } | undefined
    if (!row) throw new ArtifactNotFoundError()
    return JSON.parse(row.payload_json) as StoredChangeSet
  }
  proposalVersion(id: string, version: number): StoredChangeSet {
    const row = this.db
      .prepare(
        'SELECT payload_json FROM artifact_change_set_events WHERE store_id=? AND id=? AND version=?'
      )
      .get(this.storeId, id, version) as { payload_json: string } | undefined
    if (!row) throw new ArtifactNotFoundError()
    return JSON.parse(row.payload_json) as StoredChangeSet
  }
  proposalRequest(requestId: string): StoredChangeSet | undefined {
    const row = this.db
      .prepare(
        'SELECT payload_json FROM artifact_change_set_events WHERE store_id=? AND request_id=?'
      )
      .get(this.storeId, requestId) as { payload_json: string } | undefined
    return row ? (JSON.parse(row.payload_json) as StoredChangeSet) : undefined
  }
  appendProposal(value: StoredChangeSet): void {
    this.db
      .prepare(
        'INSERT INTO artifact_change_set_events(store_id,id,version,request_id,payload_json) VALUES(?,?,?,?,?)'
      )
      .run(
        this.storeId,
        value.id,
        value.version,
        value.requestId,
        JSON.stringify(value)
      )
  }
  validation(id: string): StoredValidation {
    const row = this.db
      .prepare(
        'SELECT payload_json FROM artifact_validation_current WHERE store_id=? AND id=?'
      )
      .get(this.storeId, id) as { payload_json: string } | undefined
    if (!row) throw new ArtifactNotFoundError()
    return JSON.parse(row.payload_json) as StoredValidation
  }
  appendValidation(
    value: StoredValidation,
    eventKind = ['pass', 'conflict'].includes(value.state)
      ? 'completed'
      : value.state
  ): void {
    const payload = JSON.stringify({ ...value, eventKind })
    this.db
      .prepare(
        'INSERT INTO artifact_validation_events(store_id,id,payload_json) VALUES(?,?,?)'
      )
      .run(this.storeId, value.id, payload)
    this.db
      .prepare(
        'INSERT INTO artifact_validation_current VALUES(?,?,?) ON CONFLICT(store_id,id) DO UPDATE SET payload_json=excluded.payload_json'
      )
      .run(this.storeId, value.id, payload)
  }
  history(id: string, afterSeq = 0, limit = 50) {
    return (
      this.db
        .prepare(
          'SELECT seq,payload_json FROM artifact_validation_events WHERE store_id=? AND id=? AND seq>? ORDER BY seq LIMIT ?'
        )
        .all(this.storeId, id, afterSeq, limit) as {
        seq: number
        payload_json: string
      }[]
    ).map(row => ({
      seq: row.seq,
      validation: JSON.parse(row.payload_json) as StoredValidation
    }))
  }
  rebuild(): void {
    this.db
      .prepare('DELETE FROM artifact_validation_current WHERE store_id=?')
      .run(this.storeId)
    this.db
      .prepare(
        `INSERT INTO artifact_validation_current SELECT store_id,id,payload_json FROM artifact_validation_events e WHERE store_id=? AND seq=(SELECT MAX(seq) FROM artifact_validation_events n WHERE n.store_id=e.store_id AND n.id=e.id)`
      )
      .run(this.storeId)
  }
  lease() {
    return this.db
      .prepare(
        'SELECT validation_id,owner,owner_pid,expires_at FROM artifact_validation_leases WHERE store_id=?'
      )
      .get(this.storeId) as
      | {
          validation_id: string
          owner: string
          owner_pid: number
          expires_at: number
        }
      | undefined
  }
  claim(id: string, owner: string, now: number, ttl: number): void {
    if (this.lease()) {
      throw artifactLeaseBusyError('Another validation job is active.')
    }
    this.db
      .prepare('INSERT INTO artifact_validation_leases VALUES(?,?,?,?,?)')
      .run(this.storeId, id, owner, process.pid, now + ttl)
  }
  release(id: string, owner: string): void {
    this.db
      .prepare(
        'DELETE FROM artifact_validation_leases WHERE store_id=? AND validation_id=? AND owner=?'
      )
      .run(this.storeId, id, owner)
  }
  /** Records that `owner` is alive; old rows of dead owners are dropped. */
  beat(owner: string, now: number, keepMs: number): void {
    this.db
      .prepare(
        `INSERT INTO artifact_owner_heartbeats VALUES(?,?,?)
         ON CONFLICT(store_id,owner) DO UPDATE SET beat_at=excluded.beat_at`
      )
      .run(this.storeId, owner, now)
    this.db
      .prepare(
        'DELETE FROM artifact_owner_heartbeats WHERE store_id=? AND beat_at<?'
      )
      .run(this.storeId, now - keepMs)
  }
  forget(owner: string): void {
    this.db
      .prepare(
        'DELETE FROM artifact_owner_heartbeats WHERE store_id=? AND owner=?'
      )
      .run(this.storeId, owner)
  }
  /** Time of the last heartbeat, or undefined when the owner never wrote one. */
  heartbeat(owner: string): number | undefined {
    const row = this.db
      .prepare(
        'SELECT beat_at FROM artifact_owner_heartbeats WHERE store_id=? AND owner=?'
      )
      .get(this.storeId, owner) as { beat_at: number } | undefined
    return row?.beat_at
  }
  appendAuthorization(id: string, data: unknown): void {
    this.db
      .prepare(
        'INSERT INTO artifact_user_authorizations(store_id,id,payload_json) VALUES(?,?,?)'
      )
      .run(this.storeId, id, JSON.stringify(data))
  }
  authorizationEvent(id: string, kind: string, data: unknown): void {
    this.db
      .prepare(
        'INSERT INTO artifact_authorization_events(store_id,id,kind,payload_json) VALUES(?,?,?,?)'
      )
      .run(this.storeId, id, kind, JSON.stringify(data))
  }
  consumed(id: string): boolean {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM artifact_authorization_events WHERE store_id=? AND id=? AND kind='consumed'"
        )
        .get(this.storeId, id)
    )
  }
  commitRequest(requestId: string) {
    const row = this.db
      .prepare(
        'SELECT seq,payload_hash,result_json FROM artifact_lifecycle_commits WHERE store_id=? AND request_id=?'
      )
      .get(this.storeId, requestId) as
      | { seq: number; payload_hash: string; result_json: string }
      | undefined
    return row
      ? {
          payloadHash: row.payload_hash,
          result: {
            ...JSON.parse(row.result_json),
            eventSeq: row.seq
          } as Record<string, unknown>
        }
      : undefined
  }
  appendCommit(
    requestId: string,
    payloadHash: string,
    result: unknown
  ): number {
    const inserted = this.db
      .prepare(
        'INSERT INTO artifact_lifecycle_commits(store_id,request_id,payload_hash,result_json) VALUES(?,?,?,?)'
      )
      .run(this.storeId, requestId, payloadHash, JSON.stringify(result))
    return Number(inserted.lastInsertRowid)
  }
}
