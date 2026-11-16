import { journalProvenance } from '../../shared/task-journal/provenance.ts'
import { normalizeSearch } from '../../shared/artifacts/search.ts'
import type { DatabaseSync } from 'node:sqlite'
import type { ArtifactActor } from '../../shared/artifacts/types.ts'
import { JOURNAL_EVENT_TYPES } from '../../shared/task-journal/constants.ts'
import type {
  Handoff,
  HandoffPreview,
  JournalEntry,
  JournalProvenance,
  JournalSearchInput,
  JournalSearchEntry
} from '../../shared/task-journal/types.ts'

export interface StoredHandoff extends Handoff {
  input: HandoffPreview
  taskVersion: number
  sessionTaskIds?: string[]
  sourceThroughSeq?: number
}

// Server facts written before eventType existed used this user actor.
const LEGACY_SERVER_ACTOR_ID = 'server'

// Recover legacy metadata only from the same response, within the requested snapshot.
const JOURNAL_READ_CTE = `WITH journal_entries AS (
  SELECT j.*, COALESCE(
    json_extract(j.snapshot_json,'$.provenance'),
    json_extract(j.snapshot_json,'$.context'),
    (SELECT json_extract(source.snapshot_json,'$.context') FROM task_journal_entries source
      WHERE source.store_id=j.store_id
      AND source.source_event_id='turn:' || json_extract(j.snapshot_json,'$.sessionId') || ':' || json_extract(j.snapshot_json,'$.turnId')
      AND source.seq<=? AND json_type(source.snapshot_json,'$.context')='object'
      ORDER BY source.seq DESC LIMIT 1)
  ) provenance_json FROM task_journal_entries j
)`

/**
 * Reads a stored entry and upgrades rows written before eventType existed.
 * Rows are immutable, so the upgrade happens on read and never rewrites them.
 */
function parseEntry(row: {
  seq: number
  snapshot_json: string
  provenance_json?: string | null
}): JournalEntry {
  const stored = JSON.parse(row.snapshot_json) as Omit<
    JournalEntry,
    'eventType'
  > & { eventType?: JournalEntry['eventType'] }
  let eventType = stored.eventType ?? null
  let actor = stored.actor
  if (stored.kind === 'system' && stored.eventType === undefined) {
    eventType =
      JOURNAL_EVENT_TYPES.find(type => stored.body.startsWith(type)) ?? null
    if (actor.kind === 'user' && actor.id === LEGACY_SERVER_ACTOR_ID) {
      actor = { kind: 'system', id: LEGACY_SERVER_ACTOR_ID }
    }
  }
  return {
    ...stored,
    eventType,
    actor,
    seq: row.seq,
    ...(!stored.context && row.provenance_json
      ? {
          provenance: journalProvenance(
            JSON.parse(row.provenance_json) as JournalProvenance
          )
        }
      : {})
  }
}
export class TaskJournalRepository {
  readonly db: DatabaseSync
  readonly storeId: string
  constructor(db: DatabaseSync, storeId: string) {
    this.db = db
    this.storeId = storeId
    db.function('journal_normalize', { deterministic: true }, value =>
      normalizeSearch(String(value ?? ''))
    )
  }
  entry(id: string): JournalEntry | undefined {
    const row = this.db
      .prepare(
        `${JOURNAL_READ_CTE} SELECT seq,snapshot_json,provenance_json FROM journal_entries WHERE store_id=? AND id=?`
      )
      .get(Number.MAX_SAFE_INTEGER, this.storeId, id) as
      | { seq: number; snapshot_json: string; provenance_json: string | null }
      | undefined
    return row ? parseEntry(row) : undefined
  }
  append(entry: JournalEntry, sourceEventId?: string): JournalEntry {
    const result = this.db
      .prepare(
        'INSERT INTO task_journal_entries(store_id,task_id,id,snapshot_json,source_event_id) VALUES(?,?,?,?,?)'
      )
      .run(
        this.storeId,
        entry.taskId,
        entry.id,
        JSON.stringify(entry),
        sourceEventId ?? null
      )
    return { ...entry, seq: Number(result.lastInsertRowid) }
  }
  hasFact(taskId: string | null, id: string): boolean {
    return Boolean(
      this.db
        .prepare(
          'SELECT 1 FROM task_journal_entries WHERE store_id=? AND task_id IS ? AND source_event_id=?'
        )
        .get(this.storeId, taskId, id)
    )
  }
  newest(taskId: string): number {
    return (
      this.db
        .prepare(
          'SELECT COALESCE(MAX(seq),0) n FROM task_journal_entries WHERE store_id=? AND task_id=?'
        )
        .get(this.storeId, taskId) as { n: number }
    ).n
  }
  count(taskId: string): number {
    return (
      this.db
        .prepare(
          'SELECT COUNT(*) n FROM task_journal_entries WHERE store_id=? AND task_id=?'
        )
        .get(this.storeId, taskId) as { n: number }
    ).n
  }
  /** Entries of the given set that a later entry corrects. */
  supersededAmong(ids: readonly string[]): Set<string> {
    if (ids.length === 0) return new Set()
    const rows = this.db
      .prepare(
        `SELECT json_extract(snapshot_json,'$.supersedesEntryId') id FROM task_journal_entries
        WHERE store_id=? AND json_extract(snapshot_json,'$.supersedesEntryId') IN (${ids.map(() => '?').join(',')})`
      )
      .all(this.storeId, ...ids) as { id: string }[]
    return new Set(rows.map(row => row.id))
  }
  page(
    taskId: string,
    through: number,
    before: number,
    limit: number
  ): JournalEntry[] {
    return (
      this.db
        .prepare(
          `${JOURNAL_READ_CTE} SELECT seq,snapshot_json,provenance_json FROM journal_entries WHERE store_id=? AND task_id=? AND seq<=? AND seq<? ORDER BY seq DESC LIMIT ?`
        )
        .all(through, this.storeId, taskId, through, before, limit) as {
        seq: number
        snapshot_json: string
        provenance_json: string | null
      }[]
    ).map(parseEntry)
  }
  sessionPage(
    sessionId: string,
    through: number,
    before: number,
    limit: number
  ): JournalEntry[] {
    return (
      this.db
        .prepare(`${JOURNAL_READ_CTE}
      SELECT seq,snapshot_json,provenance_json FROM journal_entries
      WHERE store_id=? AND seq<? AND seq IN (
        SELECT MIN(seq) FROM task_journal_entries
        WHERE store_id=? AND json_extract(snapshot_json,'$.sessionId')=? AND seq<=?
        GROUP BY COALESCE(source_event_id,id)
      ) ORDER BY seq DESC LIMIT ?`)
        .all(
          through,
          this.storeId,
          before,
          this.storeId,
          sessionId,
          through,
          limit
        ) as {
        seq: number
        snapshot_json: string
        provenance_json: string | null
      }[]
    ).map(parseEntry)
  }
  sessionNewest(sessionId: string): number {
    return (
      this.db
        .prepare(
          "SELECT COALESCE(MAX(seq),0) n FROM task_journal_entries WHERE store_id=? AND json_extract(snapshot_json,'$.sessionId')=?"
        )
        .get(this.storeId, sessionId) as { n: number }
    ).n
  }
  sessionRequests(sessionId: string, through: number): JournalEntry[] {
    const read = (order: 'ASC' | 'DESC') =>
      this.db
        .prepare(`SELECT seq,snapshot_json FROM task_journal_entries
      WHERE store_id=? AND json_extract(snapshot_json,'$.sessionId')=? AND seq<=? AND (
        COALESCE(json_extract(snapshot_json,'$.context.prompt'),'')<>'' OR
        CASE WHEN json_valid(json_extract(snapshot_json,'$.body')) THEN json_extract(json_extract(snapshot_json,'$.body'),'$.type')='request' ELSE 0 END
      ) ORDER BY seq ${order} LIMIT 1`)
        .get(this.storeId, sessionId, through) as
        | { seq: number; snapshot_json: string }
        | undefined
    const first = read('ASC'),
      last = read('DESC')
    return [first, last]
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .map(parseEntry)
  }
  newestInStore(): number {
    return (
      this.db
        .prepare(
          'SELECT COALESCE(MAX(seq),0) n FROM task_journal_entries WHERE store_id=?'
        )
        .get(this.storeId) as { n: number }
    ).n
  }
  search(
    query: JournalSearchInput,
    through: number,
    limit: number
  ): JournalSearchEntry[] {
    const conditions = ['j.store_id=?', 'j.seq<=?', 'j.seq<?']
    const params: (string | number)[] = [
      this.storeId,
      through,
      query.beforeSeq ?? Number.MAX_SAFE_INTEGER
    ]
    if (query.sessionId) {
      conditions.push("json_extract(j.snapshot_json,'$.sessionId')=?")
      params.push(query.sessionId)
    }
    if (query.taskId) {
      conditions.push('j.task_id=?')
      params.push(query.taskId)
    }
    if (query.query) {
      conditions.push(
        `instr(journal_normalize(
          json_extract(j.snapshot_json,'$.body') || ' ' ||
          COALESCE(json_extract(j.snapshot_json,'$.context.prompt'),'') || ' ' ||
          COALESCE(json_extract(j.snapshot_json,'$.context.response'),'') || ' ' ||
          COALESCE(json_extract(j.provenance_json,'$.agentName'),'') || ' ' ||
          COALESCE(json_extract(j.provenance_json,'$.model'),'') || ' ' ||
          COALESCE(json_extract(j.snapshot_json,'$.sessionId'),'')),?)>0`
      )
      params.push(normalizeSearch(query.query))
    }
    for (const field of ['agentName', 'model'] as const) {
      if (query[field]) {
        conditions.push(`json_extract(j.provenance_json,'$.${field}')=?`)
        params.push(query[field])
      }
    }
    if (query.kind) {
      conditions.push("json_extract(j.snapshot_json,'$.kind')=?")
      params.push(query.kind)
    }
    if (query.author) {
      // Older server facts stored a user actor before eventType was introduced.
      conditions.push(`CASE WHEN json_extract(j.snapshot_json,'$.kind')='system'
        AND json_type(j.snapshot_json,'$.eventType') IS NULL
        AND json_extract(j.snapshot_json,'$.actor.kind')='user'
        AND json_extract(j.snapshot_json,'$.actor.id')='server'
        THEN 'system' ELSE json_extract(j.snapshot_json,'$.actor.kind') END=?`)
      params.push(query.author)
    }
    for (const [bound, operator] of [
      [query.createdFrom, '>='],
      [query.createdTo, '<=']
    ] as const) {
      if (bound) {
        conditions.push(
          `json_extract(j.snapshot_json,'$.createdAt')${operator}?`
        )
        params.push(bound)
      }
    }
    const rows = this.db
      .prepare(`${JOURNAL_READ_CTE} SELECT j.seq,j.snapshot_json,j.provenance_json,
      json_extract(t.snapshot_json,'$.title') task_title,
      EXISTS(SELECT 1 FROM task_journal_entries c WHERE c.store_id=j.store_id AND c.seq<=?
        AND json_extract(c.snapshot_json,'$.supersedesEntryId')=j.id) superseded
      FROM journal_entries j LEFT JOIN task_current t ON t.store_id=j.store_id AND t.id=j.task_id
      WHERE ${conditions.join(' AND ')} ORDER BY j.seq DESC LIMIT ?`)
      .all(through, through, ...params, limit) as {
      seq: number
      snapshot_json: string
      provenance_json: string | null
      task_title: string | null
      superseded: number
    }[]
    return rows.map(row => ({
      ...parseEntry(row),
      taskTitle: row.task_title,
      isSuperseded: Boolean(row.superseded)
    }))
  }
  // The journal is append-only. A new newest seq is the only reason for new filter values.
  private readonly filterOptionsCache = new Map<
    string,
    { seq: number; value: { agentNames: string[]; models: string[] } }
  >()
  filterOptions(taskId?: string): { agentNames: string[]; models: string[] } {
    const seq = this.newestInStore()
    const cached = this.filterOptionsCache.get(taskId ?? '')
    if (cached?.seq === seq) {
      return {
        agentNames: [...cached.value.agentNames],
        models: [...cached.value.models]
      }
    }
    const value = this.readFilterOptions(taskId)
    this.filterOptionsCache.set(taskId ?? '', { seq, value })
    return { agentNames: [...value.agentNames], models: [...value.models] }
  }
  private readFilterOptions(taskId?: string): {
    agentNames: string[]
    models: string[]
  } {
    const values = (field: 'agentName' | 'model') => {
      const rows = this.db
        .prepare(`${JOURNAL_READ_CTE} SELECT DISTINCT json_extract(provenance_json,'$.${field}') value
        FROM journal_entries WHERE store_id=? ${taskId ? 'AND task_id=?' : ''}
        AND json_extract(provenance_json,'$.${field}') IS NOT NULL
        AND json_extract(provenance_json,'$.${field}') != '' ORDER BY value`)
        .all(
          Number.MAX_SAFE_INTEGER,
          this.storeId,
          ...(taskId ? [taskId] : [])
        ) as {
        value: string
      }[]
      return rows.map(row => row.value)
    }
    return { agentNames: values('agentName'), models: values('model') }
  }
  isSuperseded(id: string): boolean {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM task_journal_entries WHERE store_id=? AND json_extract(snapshot_json,'$.supersedesEntryId')=? LIMIT 1"
        )
        .get(this.storeId, id)
    )
  }
  replay(requestId: string): { hash: string; entry: JournalEntry } | undefined {
    const row = this.db
      .prepare(
        'SELECT payload_hash,result_json FROM task_journal_operations WHERE store_id=? AND request_id=?'
      )
      .get(this.storeId, requestId) as
      | { payload_hash: string; result_json: string }
      | undefined
    return row
      ? {
          hash: row.payload_hash,
          entry: JSON.parse(row.result_json) as JournalEntry
        }
      : undefined
  }
  receipt(requestId: string, hash: string, entry: JournalEntry): void {
    this.db
      .prepare('INSERT INTO task_journal_operations VALUES(?,?,?,?)')
      .run(this.storeId, requestId, hash, JSON.stringify(entry))
  }
  handoffOwner(id: string): string | undefined {
    const row = this.db
      .prepare(
        'SELECT owner_id FROM task_handoff_operations WHERE store_id=? AND id=?'
      )
      .get(this.storeId, id)
    return typeof row?.owner_id === 'string' ? row.owner_id : undefined
  }
  /** Preparing operations with their owners, for interruption checks. */
  preparingHandoffs(): { value: StoredHandoff; owner: string }[] {
    return (
      this.db
        .prepare(
          "SELECT owner_id,snapshot_json FROM task_handoff_operations WHERE store_id=? AND json_extract(snapshot_json,'$.state')='preparing'"
        )
        .all(this.storeId) as { owner_id: string; snapshot_json: string }[]
    ).map(row => ({
      value: JSON.parse(row.snapshot_json) as StoredHandoff,
      owner: row.owner_id
    }))
  }
  /**
   * Removes expired previews and old finished receipts with their snapshots.
   * Preparing operations stay until their owner finishes or is declared dead.
   */
  purgeHandoffs(now: number, retentionMs: number): number {
    return Number(
      this.db
        .prepare(
          `DELETE FROM task_handoff_operations WHERE store_id=? AND (
          (json_extract(snapshot_json,'$.state')='preview' AND json_extract(snapshot_json,'$.expiresAt')<?)
          OR (json_extract(snapshot_json,'$.state') IN ('ready','failed','interrupted')
            AND json_extract(snapshot_json,'$.expiresAt')<?))`
        )
        .run(this.storeId, now, now - retentionMs).changes
    )
  }
  handoff(id: string): StoredHandoff | undefined {
    const row = this.db
      .prepare(
        'SELECT snapshot_json FROM task_handoff_operations WHERE store_id=? AND id=?'
      )
      .get(this.storeId, id) as { snapshot_json: string } | undefined
    return row ? (JSON.parse(row.snapshot_json) as StoredHandoff) : undefined
  }
  handoffReplay(
    requestId: string
  ): { hash: string; actor: ArtifactActor; value: StoredHandoff } | undefined {
    const row = this.db
      .prepare(
        'SELECT payload_hash,actor_json,snapshot_json FROM task_handoff_operations WHERE store_id=? AND request_id=?'
      )
      .get(this.storeId, requestId) as
      | { payload_hash: string; actor_json: string; snapshot_json: string }
      | undefined
    return row
      ? {
          hash: row.payload_hash,
          actor: JSON.parse(row.actor_json) as ArtifactActor,
          value: JSON.parse(row.snapshot_json) as StoredHandoff
        }
      : undefined
  }
  createHandoff(
    value: StoredHandoff,
    hash: string,
    actor: ArtifactActor,
    owner: string
  ): void {
    this.db
      .prepare('INSERT INTO task_handoff_operations VALUES(?,?,?,?,?,?,?)')
      .run(
        this.storeId,
        value.id,
        value.input.requestId,
        hash,
        JSON.stringify(actor),
        owner,
        JSON.stringify(value)
      )
  }
  claimHandoff(value: StoredHandoff, owner: string): boolean {
    return (
      this.db
        .prepare(
          "UPDATE task_handoff_operations SET snapshot_json=?,owner_id=? WHERE store_id=? AND id=? AND json_extract(snapshot_json,'$.state')='preview' AND json_extract(snapshot_json,'$.digest')=?"
        )
        .run(JSON.stringify(value), owner, this.storeId, value.id, value.digest)
        .changes === 1
    )
  }
  updateHandoff(value: StoredHandoff): void {
    this.db
      .prepare(
        'UPDATE task_handoff_operations SET snapshot_json=? WHERE store_id=? AND id=?'
      )
      .run(JSON.stringify(value), this.storeId, value.id)
  }
}
