import type { DatabaseSync } from 'node:sqlite'
import type { ArtifactActor } from '../../shared/artifacts/types.ts'
import type { Task, ArtifactType } from '../../shared/tasks/types.ts'
import { ArtifactConflictError } from '../errors/artifacts.ts'
import { normalizeStoredTask } from '../../shared/tasks/normalize.ts'
import { assertRequestIdFree } from './request-ids.ts'
import { taskCreatedAtSql } from '../db/artifact-graph-migrations.ts'
import type { KeyedRow, PageKey } from '../utils/artifact-page.ts'

export type Definition = Task | ArtifactType
export interface DefinitionEvent<T> {
  snapshot: T
  requestId: string
  actor: ArtifactActor
  createdAt: string
}

export interface TaskPageQuery {
  /** The key of the last task on the previous page. */
  after?: PageKey
  limit: number
  state?: Task['state']
  tags: string[]
  tagMode: 'all' | 'any'
  /** Lower-case search text; an empty string disables search. */
  needle: string
}

interface VersionedRow {
  snapshot_json: string
  first_at: string
}

interface TaskRow extends VersionedRow {
  id: string
  created_at: string | null
}

// The first version time is the creation time of a snapshot that stores none.
function currentSql(kind: 'task' | 'artifact_type', columns = ''): string {
  return `SELECT c.snapshot_json${columns}, (SELECT v.created_at FROM ${kind}_versions v
    WHERE v.store_id=c.store_id AND v.id=c.id AND v.version=1) AS first_at
    FROM ${kind}_current c WHERE c.store_id=?`
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- The caller supplies the domain type for stored JSON.
function parseDefinition<T extends Definition>(
  kind: 'task' | 'artifact_type',
  json: string,
  firstVersionAt?: string
): T {
  const value = JSON.parse(json) as Definition
  return (
    kind === 'task' ? normalizeStoredTask(value as Task, firstVersionAt) : value
  ) as T
}

export class TaskRepository {
  readonly db: DatabaseSync
  readonly storeId: string
  constructor(db: DatabaseSync, storeId: string) {
    this.db = db
    this.storeId = storeId
    // SQLite lower() changes only ASCII letters; search must match the JS lower case.
    db.function('task_lower', { deterministic: true }, value =>
      String(value ?? '').toLocaleLowerCase()
    )
  }

  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- The caller supplies the domain type for stored JSON.
  get<T extends Definition>(
    kind: 'task' | 'artifact_type',
    id: string
  ): T | undefined {
    const row = this.db
      .prepare(`${currentSql(kind)} AND c.id=?`)
      .get(this.storeId, id) as unknown as VersionedRow | undefined
    return row
      ? parseDefinition<T>(kind, row.snapshot_json, row.first_at)
      : undefined
  }
  all<T extends Definition>(kind: 'task' | 'artifact_type'): T[] {
    return (
      this.db
        .prepare(`${currentSql(kind)} ORDER BY c.id`)
        .all(this.storeId) as unknown as VersionedRow[]
    ).map(row => parseDefinition<T>(kind, row.snapshot_json, row.first_at))
  }
  /**
   * One filtered page after the key, in the task_current_created index order.
   * Tasks without a creation time come last, so they are read in a second query.
   * Each query is an index range; a single OR condition scans from the start.
   */
  taskPage(query: TaskPageQuery): KeyedRow<Task>[] {
    const filters: string[] = []
    const params: string[] = []
    if (query.state) {
      filters.push("json_extract(c.snapshot_json,'$.state')=?")
      params.push(query.state)
    }
    if (query.tags.length) {
      filters.push(
        query.tagMode === 'any'
          ? "EXISTS (SELECT 1 FROM json_each(c.snapshot_json,'$.tags') t WHERE t.value IN (SELECT value FROM json_each(?)))"
          : "NOT EXISTS (SELECT 1 FROM json_each(?) w WHERE w.value NOT IN (SELECT value FROM json_each(c.snapshot_json,'$.tags')))"
      )
      params.push(JSON.stringify(query.tags))
    }
    if (query.needle) {
      filters.push(
        "instr(task_lower(json_extract(c.snapshot_json,'$.title') || ' ' || c.id),?)>0"
      )
      params.push(query.needle)
    }
    const read = (range: string, rangeParams: string[], limit: number) =>
      (
        this.db
          .prepare(
            `${currentSql('task', ',c.id,c.created_at')} AND ${range}${filters.map(filter => ` AND ${filter}`).join('')} ORDER BY c.created_at DESC NULLS LAST, c.id LIMIT ?`
          )
          .all(
            this.storeId,
            ...rangeParams,
            ...params,
            limit
          ) as unknown as TaskRow[]
      ).map(row => ({
        item: parseDefinition<Task>('task', row.snapshot_json, row.first_at),
        key: { createdAt: row.created_at, id: row.id }
      }))
    const { after, limit } = query
    const at = after?.createdAt
    // Ranges follow the sort order: the rest of the same time, older times, no time.
    const stages: [string, string[]][] = []
    if (after && at === null) {
      stages.push(['c.created_at IS NULL AND c.id>?', [after.id]])
    } else {
      if (after && typeof at === 'string') {
        stages.push(['c.created_at=? AND c.id>?', [at, after.id]])
        stages.push(['c.created_at<?', [at]])
      } else {
        stages.push(['c.created_at IS NOT NULL', []])
      }
      stages.push(['c.created_at IS NULL', []])
    }
    const rows: KeyedRow<Task>[] = []
    for (const [range, rangeParams] of stages) {
      rows.push(...read(range, rangeParams, limit - rows.length))
      if (rows.length >= limit) break
    }
    return rows
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
      snapshot: parseDefinition<T>(kind, row.snapshot_json),
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
    // An edit keeps the creation time of the first insert.
    const upsert =
      'ON CONFLICT(store_id,id) DO UPDATE SET snapshot_json=excluded.snapshot_json'
    if (kind === 'task') {
      this.db
        .prepare(
          `INSERT INTO task_current(store_id,id,snapshot_json,created_at) VALUES(?,?,?,?) ${upsert}`
        )
        .run(
          this.storeId,
          snapshot.id,
          JSON.stringify(snapshot),
          (snapshot as Task).createdAt ?? now
        )
    } else {
      this.db
        .prepare(
          `INSERT INTO artifact_type_current(store_id,id,snapshot_json) VALUES(?,?,?) ${upsert}`
        )
        .run(this.storeId, snapshot.id, JSON.stringify(snapshot))
    }
  }
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- The command owner knows the stored result type.
  replay<T>(requestId: string, hash: string): { result: T } | undefined {
    this.assertJournalRequest(requestId)
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
  private assertJournalRequest(requestId: string): void {
    assertRequestIdFree(
      this.db,
      this.storeId,
      requestId,
      ['task_journal_operations', 'task_handoff_operations'],
      'Request identifier belongs to a task journal operation.'
    )
  }
  assertArtifactRequest(requestId: string): void {
    this.assertJournalRequest(requestId)
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
  artifactCounts(taskIds: string[]): Map<string, number> {
    if (!taskIds.length) return new Map()
    const rows = this.db
      .prepare(`SELECT task_id, COUNT(*) AS count FROM artifact_task_links
      WHERE store_id=? AND task_id IN (${taskIds.map(() => '?').join(',')}) GROUP BY task_id`)
      .all(this.storeId, ...taskIds) as { task_id: string; count: number }[]
    return new Map(rows.map(row => [row.task_id, row.count]))
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
      const createdAt = kind === 'task' ? taskCreatedAtSql('v') : undefined
      this.db
        .prepare(
          `INSERT INTO ${kind}_current(store_id,id,snapshot_json${createdAt ? ',created_at' : ''}) SELECT v.store_id,v.id,v.snapshot_json${createdAt ? `,${createdAt}` : ''} FROM ${kind}_versions v WHERE v.store_id=? AND v.version=(SELECT MAX(n.version) FROM ${kind}_versions n WHERE n.store_id=v.store_id AND n.id=v.id)`
        )
        .run(this.storeId)
    }
  }
}
