import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import {
  TaskRepository,
  type TaskPageQuery
} from '../../../src/server/repositories/task.repo.ts'
import type { PageKey } from '../../../src/server/utils/artifact-page.ts'
import type { ArtifactType, Task } from '../../../src/shared/tasks/types.ts'

// Isolate the repository fixture from persistent stores.
const STORE_ID = 'store'
// Keep version authors deterministic in the fixture.
const ACTOR = { kind: 'user' as const, id: 'local' }
// Read the whole fixture in one page unless a test sets a limit.
const ALL: TaskPageQuery = {
  limit: 100,
  tags: [],
  tagMode: 'all',
  needle: ''
}

function task(
  id: string,
  createdAt?: string,
  fields: Partial<Task> = {}
): Task {
  return {
    storeId: STORE_ID,
    id,
    version: 1,
    title: id,
    state: 'open',
    description: '',
    links: [],
    tags: [],
    ...(createdAt === undefined ? {} : { createdAt }),
    ...fields
  } as Task
}

// Create a task whose version time equals its creation time.
function addTask(
  repository: TaskRepository,
  id: string,
  at: string,
  fields: Partial<Task> = {}
): void {
  repository.append('task', task(id, at, fields), id, ACTOR, at)
}

function artifactType(id: string): ArtifactType {
  return { storeId: STORE_ID, id, version: 1, label: id, active: true }
}

function setup() {
  const db = createTestDatabase()
  return { db, repository: new TaskRepository(db, STORE_ID) }
}

function ids(
  repository: TaskRepository,
  query: Partial<TaskPageQuery> = {}
): string[] {
  return repository.taskPage({ ...ALL, ...query }).map(row => row.item.id)
}

// Read every page of the given size and return the ids in page order.
function pagedIds(
  repository: TaskRepository,
  limit: number,
  between?: (after: PageKey) => void
): string[][] {
  const pages: string[][] = []
  let after: PageKey | undefined
  for (;;) {
    const rows = repository.taskPage({ ...ALL, after, limit })
    if (!rows.length) return pages
    pages.push(rows.map(row => row.item.id))
    after = rows.at(-1)?.key
    if (after) between?.(after)
  }
}

test('tasks are ordered by creation time, newest first', () => {
  const { db, repository } = setup()
  addTask(repository, 'a', '2026-01-03T00:00:00.000Z')
  addTask(repository, 'b', '2026-01-01T00:00:00.000Z')
  addTask(repository, 'c', '2026-01-02T00:00:00.000Z')
  assert.deepEqual(ids(repository), ['a', 'c', 'b'])
  db.close()
})

test('tasks with equal creation time keep id order', () => {
  const { db, repository } = setup()
  for (const id of ['c', 'a', 'b']) {
    addTask(repository, id, '2026-01-01T00:00:00.000Z')
  }
  assert.deepEqual(ids(repository), ['a', 'b', 'c'])
  db.close()
})

test('editing a task keeps its creation time and place in the list', () => {
  const { db, repository } = setup()
  addTask(repository, 'a', '2026-01-01T00:00:00.000Z')
  addTask(repository, 'b', '2026-01-02T00:00:00.000Z')
  repository.append(
    'task',
    task('a', '2026-01-01T00:00:00.000Z', { version: 2, title: 'Edited' }),
    'edit-a',
    ACTOR,
    '2026-03-01T00:00:00.000Z'
  )
  const items = repository.taskPage(ALL).map(row => row.item)
  assert.deepEqual(
    items.map(item => item.id),
    ['b', 'a']
  )
  assert.equal(items[1]?.title, 'Edited')
  assert.equal(items[1]?.createdAt, '2026-01-01T00:00:00.000Z')
  db.close()
})

test('a legacy task without creation time sorts by its first version time', () => {
  const { db, repository } = setup()
  repository.append(
    'task',
    task('legacy'),
    'legacy',
    ACTOR,
    '2026-01-01T00:00:00.000Z'
  )
  repository.append(
    'task',
    task('legacy', undefined, { version: 2, title: 'Edited' }),
    'edit-legacy',
    ACTOR,
    '2026-03-01T00:00:00.000Z'
  )
  addTask(repository, 'newer', '2026-02-01T00:00:00.000Z')
  const items = repository.taskPage(ALL).map(row => row.item)
  assert.deepEqual(
    items.map(item => item.id),
    ['newer', 'legacy']
  )
  assert.equal(items[1]?.createdAt, '2026-01-01T00:00:00.000Z')
  db.close()
})

test('tasks with no creation time sort last, and pages pass them without gaps', () => {
  const { db, repository } = setup()
  addTask(repository, 'newer', '2026-01-02T00:00:00.000Z')
  addTask(repository, 'older', '2026-01-01T00:00:00.000Z')
  for (const id of ['b', 'a']) {
    db.prepare(
      'INSERT INTO task_current(store_id,id,snapshot_json) VALUES(?,?,?)'
    ).run(STORE_ID, id, JSON.stringify(task(id)))
  }
  assert.deepEqual(ids(repository), ['newer', 'older', 'a', 'b'])
  assert.deepEqual(
    repository.taskPage(ALL).map(row => row.key),
    [
      { createdAt: '2026-01-02T00:00:00.000Z', id: 'newer' },
      { createdAt: '2026-01-01T00:00:00.000Z', id: 'older' },
      { createdAt: null, id: 'a' },
      { createdAt: null, id: 'b' }
    ]
  )
  // Page boundaries before, on and after the first task without a time.
  for (const limit of [1, 2, 3]) {
    assert.deepEqual(
      pagedIds(repository, limit).flat(),
      ['newer', 'older', 'a', 'b'],
      `limit ${limit}`
    )
  }
  db.close()
})

test('the next page starts after the key, also with equal creation times', () => {
  const { db, repository } = setup()
  const at = '2026-01-01T00:00:00.000Z'
  for (const id of ['d', 'b', 'a', 'c']) addTask(repository, id, at)
  addTask(repository, 'new', '2026-01-02T00:00:00.000Z')
  assert.deepEqual(pagedIds(repository, 2), [['new', 'a'], ['b', 'c'], ['d']])
  db.close()
})

test('changes between pages do not cause gaps or repeats', () => {
  const { db, repository } = setup()
  for (const [id, day] of [
    ['a', '05'],
    ['b', '04'],
    ['c', '03'],
    ['d', '02'],
    ['e', '01']
  ] as const) {
    addTask(repository, id, `2026-01-${day}T00:00:00.000Z`)
  }
  let changed = false
  const pages = pagedIds(repository, 2, () => {
    if (changed) return
    changed = true
    // A new task goes above the cursor; an edit keeps the place of a task.
    addTask(repository, 'new', '2026-02-01T00:00:00.000Z')
    repository.append(
      'task',
      task('d', '2026-01-02T00:00:00.000Z', { version: 2, title: 'Edited' }),
      'edit-d',
      ACTOR,
      '2026-02-02T00:00:00.000Z'
    )
  })
  assert.deepEqual(pages, [['a', 'b'], ['c', 'd'], ['e']])
  db.close()
})

test('rebuild restores the creation time of current tasks', () => {
  const { db, repository } = setup()
  repository.append(
    'task',
    task('legacy'),
    'legacy',
    ACTOR,
    '2026-01-01T00:00:00.000Z'
  )
  addTask(repository, 'newer', '2026-02-01T00:00:00.000Z')
  repository.rebuild()
  assert.deepEqual(
    db
      .prepare('SELECT id,created_at FROM task_current ORDER BY id')
      .all()
      .map(row => [row.id, row.created_at]),
    [
      ['legacy', '2026-01-01T00:00:00.000Z'],
      ['newer', '2026-02-01T00:00:00.000Z']
    ]
  )
  db.close()
})

test('state, tags and search filter the page in SQL', () => {
  const { db, repository } = setup()
  addTask(repository, 'one', '2026-01-03T00:00:00.000Z', {
    title: 'Задача Один',
    tags: ['ui', 'api']
  })
  addTask(repository, 'two', '2026-01-02T00:00:00.000Z', {
    title: 'Second',
    tags: ['ui'],
    state: 'closed'
  })
  addTask(repository, 'three', '2026-01-01T00:00:00.000Z', {
    title: 'Третья задача'
  })
  assert.deepEqual(ids(repository, { state: 'open' }), ['one', 'three'])
  assert.deepEqual(ids(repository, { state: 'closed' }), ['two'])
  assert.deepEqual(ids(repository, { tags: ['ui', 'api'] }), ['one'])
  assert.deepEqual(ids(repository, { tags: ['api', 'none'], tagMode: 'any' }), [
    'one'
  ])
  // An empty tag list does not filter in any mode.
  assert.deepEqual(ids(repository, { tagMode: 'any' }), ['one', 'two', 'three'])
  // Search ignores the case of non-ASCII letters and also matches ids.
  assert.deepEqual(ids(repository, { needle: 'задача' }), ['one', 'three'])
  assert.deepEqual(ids(repository, { needle: 'thr' }), ['three'])
  assert.deepEqual(
    ids(repository, { state: 'open', tags: ['ui'], needle: 'один' }),
    ['one']
  )
  db.close()
})

test('each task page query reads an index range without a sort step', t => {
  const { db, repository } = setup()
  const prepare = db.prepare.bind(db)
  const plans: string[] = []
  t.mock.method(db, 'prepare', (sql: string) => {
    const statement = prepare(sql)
    return {
      all: (...params: unknown[]) => {
        plans.push(
          prepare(`EXPLAIN QUERY PLAN ${sql}`)
            .all(...(params as string[]))
            .map(row => String(row.detail))
            .join(' ')
        )
        return statement.all(...(params as string[]))
      }
    }
  })
  const query = { ...ALL, state: 'open' as const, limit: 10 }
  repository.taskPage(query)
  repository.taskPage({
    ...query,
    after: { createdAt: '2026-01-01T00:00:00.000Z', id: 'a' }
  })
  repository.taskPage({ ...query, after: { createdAt: null, id: 'a' } })
  // Reads: first page 2; after a dated key 3 (same time, older, no time); after null 1.
  assert.equal(plans.length, 6)
  for (const plan of plans) {
    assert.match(
      plan,
      /USING INDEX task_current_created \(store_id=\? AND created_at/
    )
    assert.doesNotMatch(plan, /TEMP B-TREE/)
  }
  // The rest of the same time is bounded by the id too, so it skips earlier ids.
  assert.match(plans[2], /created_at=\? AND id>\?/)
  db.close()
})

test('artifact types keep their previous id order', () => {
  const { db, repository } = setup()
  for (const id of ['c', 'a', 'b']) {
    repository.append(
      'artifact_type',
      artifactType(id),
      id,
      ACTOR,
      '2026-01-01T00:00:00.000Z'
    )
  }
  assert.deepEqual(
    repository.all<ArtifactType>('artifact_type').map(item => item.id),
    ['a', 'b', 'c']
  )
  db.close()
})
