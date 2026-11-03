import type { DatabaseSync } from 'node:sqlite'
import type { ArtifactActor } from '../../shared/artifacts/types.ts'
import type {
  ArtifactTransitionOperation,
  ArtifactTransitionStage
} from '../../shared/artifact-transitions/types.ts'
import { ArtifactNotFoundError } from '../errors/artifacts.ts'

/** Operation record with the private fields the API never exposes. */
export interface StoredTransition extends Omit<
  ArtifactTransitionOperation,
  'canCancel' | 'storeId'
> {
  actor: ArtifactActor
  requestDigest: string
  owner: string
  ownerPid: number
  stage: ArtifactTransitionStage
  eventKind: string
}

export interface StoredConsent {
  operationId: string
  actor: ArtifactActor
  proposalId: string
  proposalVersion: number
  changeDigest: string
  manifestDigest: string
  validationId: string
  expiresAt: number
}

export class ArtifactTransitionRepository {
  private readonly db: DatabaseSync
  readonly storeId: string
  constructor(db: DatabaseSync, storeId: string) {
    this.db = db
    this.storeId = storeId
  }

  operation(id: string): StoredTransition {
    const row = this.db
      .prepare(
        'SELECT payload_json FROM artifact_transition_current WHERE store_id=? AND id=?'
      )
      .get(this.storeId, id) as { payload_json: string } | undefined
    if (!row) {
      throw new ArtifactNotFoundError()
    }
    return JSON.parse(row.payload_json) as StoredTransition
  }
  forArtifact(artifactId: string, limit = 10): StoredTransition[] {
    const rows = this.db
      .prepare(
        'SELECT payload_json FROM artifact_transition_current WHERE store_id=? AND artifact_id=?'
      )
      .all(this.storeId, artifactId) as { payload_json: string }[]
    return rows
      .map(row => JSON.parse(row.payload_json) as StoredTransition)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
  }
  unfinished(): StoredTransition[] {
    const rows = this.db
      .prepare(
        `SELECT payload_json FROM artifact_transition_current WHERE store_id=?
         AND json_extract(payload_json,'$.stage') IN ('preparing','validating','applying')`
      )
      .all(this.storeId) as { payload_json: string }[]
    return rows.map(row => JSON.parse(row.payload_json) as StoredTransition)
  }
  append(value: StoredTransition): void {
    const payload = JSON.stringify(value)
    this.db
      .prepare(
        'INSERT INTO artifact_transition_events(store_id,id,payload_json) VALUES(?,?,?)'
      )
      .run(this.storeId, value.id, payload)
    this.db
      .prepare(
        `INSERT INTO artifact_transition_current VALUES(?,?,?,?)
         ON CONFLICT(store_id,id) DO UPDATE SET payload_json=excluded.payload_json`
      )
      .run(this.storeId, value.id, value.artifactId, payload)
  }
  history(id: string): StoredTransition[] {
    const rows = this.db
      .prepare(
        'SELECT payload_json FROM artifact_transition_events WHERE store_id=? AND id=? ORDER BY seq'
      )
      .all(this.storeId, id) as { payload_json: string }[]
    return rows.map(row => JSON.parse(row.payload_json) as StoredTransition)
  }
  rebuild(): void {
    this.db
      .prepare('DELETE FROM artifact_transition_current WHERE store_id=?')
      .run(this.storeId)
    this.db
      .prepare(
        `INSERT INTO artifact_transition_current
         SELECT store_id,id,json_extract(payload_json,'$.artifactId'),payload_json
         FROM artifact_transition_events e WHERE store_id=? AND seq=(
           SELECT MAX(seq) FROM artifact_transition_events n WHERE n.store_id=e.store_id AND n.id=e.id)`
      )
      .run(this.storeId)
  }
  request(requestId: string) {
    const row = this.db
      .prepare(
        'SELECT payload_hash,operation_id FROM artifact_transition_requests WHERE store_id=? AND request_id=?'
      )
      .get(this.storeId, requestId) as
      | { payload_hash: string; operation_id: string }
      | undefined
    return row
      ? { payloadHash: row.payload_hash, operationId: row.operation_id }
      : undefined
  }
  appendRequest(
    requestId: string,
    payloadHash: string,
    operationId: string
  ): void {
    this.db
      .prepare(
        'INSERT INTO artifact_transition_requests(store_id,request_id,payload_hash,operation_id) VALUES(?,?,?,?)'
      )
      .run(this.storeId, requestId, payloadHash, operationId)
  }
  consent(operationId: string): StoredConsent | undefined {
    const row = this.db
      .prepare(
        'SELECT payload_json FROM artifact_transition_consents WHERE store_id=? AND operation_id=?'
      )
      .get(this.storeId, operationId) as { payload_json: string } | undefined
    return row ? (JSON.parse(row.payload_json) as StoredConsent) : undefined
  }
  appendConsent(value: StoredConsent): void {
    this.db
      .prepare(
        'INSERT INTO artifact_transition_consents(store_id,operation_id,payload_json) VALUES(?,?,?)'
      )
      .run(this.storeId, value.operationId, JSON.stringify(value))
  }
}
