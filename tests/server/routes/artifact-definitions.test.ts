import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../../../src/server/app.ts'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'

async function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'ght-graph-routes-'))
  const db = createTestDatabase()
  const storage = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  const app = buildApp({
    db,
    repositoryPath: root,
    artifacts: storage,
    agentPresets: [
      {
        id: 'fake',
        title: 'Fake',
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        autoApprovesEdits: false
      }
    ]
  })
  t.after(async () => {
    await app.close()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  await app.ready()
  return { app, storage, db }
}

test('task and type APIs serialize complete definitions, lists and immutable history', async t => {
  const { app, storage } = await setup(t)
  const taskResponse = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      requestId: 'task',
      input: {
        title: 'Task',
        externalUrl: 'https://example.org/123',
        state: 'open'
      }
    }
  })
  assert.equal(taskResponse.statusCode, 200, taskResponse.body)
  const task = taskResponse.json()
  assert.deepEqual(task, storage.tasks.get(task.id))
  const closed = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${task.id}`,
    payload: {
      requestId: 'close',
      expectedVersion: 1,
      input: { title: 'Closed', externalUrl: null, state: 'closed' }
    }
  })
  assert.equal(closed.statusCode, 200, closed.body)
  assert.equal(closed.json().version, 2)
  const custom = await app.inject({
    method: 'POST',
    url: '/api/artifact-types',
    payload: {
      requestId: 'custom',
      id: 'custom',
      input: { label: 'Custom', active: true }
    }
  })
  assert.equal(custom.statusCode, 200, custom.body)
  assert.deepEqual(custom.json(), storage.types.get('custom'))
  const inactive = await app.inject({
    method: 'PATCH',
    url: '/api/artifact-types/custom',
    payload: {
      requestId: 'deactivate',
      expectedVersion: 1,
      input: { label: 'Historical custom', active: false }
    }
  })
  assert.equal(inactive.statusCode, 200, inactive.body)
  for (const [url, expected] of [
    [
      '/api/tasks',
      storage.tasks.listByState(undefined, undefined, undefined, undefined)
    ],
    [`/api/tasks/${task.id}`, storage.tasks.get(task.id)],
    [`/api/tasks/${task.id}/history`, storage.tasks.historyPage(task.id)],
    ['/api/artifact-types', storage.types.list()],
    ['/api/artifact-types/custom/history', storage.types.historyPage('custom')]
  ] as const) {
    const response = await app.inject(url)
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(response.json(), expected)
    assert.equal(response.headers['cache-control'], 'no-store')
  }
  assert.deepEqual(storage.tasks.history(task.id)[0].actor, {
    kind: 'user',
    id: 'local'
  })
})

test('dictionary API rejects stale writes, actor injection, bad URLs and deletion', async t => {
  const { app, storage } = await setup(t)
  const task = storage.tasks.create(
    'initial',
    { title: 'Task', externalUrl: null, state: 'open' },
    { kind: 'system', id: 'fixture' }
  )
  const response = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${task.id}`,
    payload: {
      requestId: 'stale',
      expectedVersion: 2,
      input: { title: 'Other', externalUrl: null, state: 'closed' }
    }
  })
  assert.equal(response.statusCode, 409, response.body)
  const url = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      requestId: 'bad',
      input: {
        title: 'Task',
        externalUrl: 'javascript:alert(1)',
        state: 'open'
      }
    }
  })
  assert.equal(url.statusCode, 400, url.body)
  // The caller cannot choose the author recorded in history.
  await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      requestId: 'actor',
      actor: { kind: 'agent', id: 'spoof' },
      input: { title: 'Task', externalUrl: null, state: 'open' }
    }
  })
  const actorTask = storage.tasks.list().items.find(item => item.id !== task.id)
  if (actorTask) {
    assert.deepEqual(storage.tasks.history(actorTask.id)[0].actor, {
      kind: 'user',
      id: 'local'
    })
  }
  for (const path of [`/api/tasks/${task.id}`, '/api/artifact-types/generic']) {
    assert.equal(
      (await app.inject({ method: 'DELETE', url: path })).statusCode,
      404
    )
  }
})

test('graph reads and preview serialize complete responses without exposing lifecycle writes', async t => {
  const { app, storage } = await setup(t)
  const actor = { kind: 'agent' as const, id: 'fixture' }
  const a = storage.create(
    { requestId: 'a', body: 'A', metadata: { title: 'A', tags: [] } },
    actor
  )
  const b = storage.create(
    {
      requestId: 'b',
      body: 'B',
      metadata: {
        title: 'B',
        tags: [],
        relations: [{ kind: 'parent', targetId: a.id }]
      },
      revisionOf: [a.id]
    },
    actor
  )
  for (const [url, expected] of [
    [
      `/api/artifacts/${a.id}/relations?direction=incoming`,
      storage.graph.relations(a.id, { direction: 'incoming' })
    ],
    [`/api/artifacts/${b.id}/ancestry`, storage.graph.ancestry(b.id)]
  ] as const) {
    const response = await app.inject(url)
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(response.json(), expected)
  }
  const payload = {
    storeId: storage.storeId,
    command: 'accept' as const,
    subjectIds: [b.id],
    expectedVersions: [
      { id: a.id, version: 1 },
      { id: b.id, version: 1 }
    ],
    relationChanges: [],
    targetStatuses: [{ artifactId: b.id, status: 'accepted' as const }],
    supplementDispositions: [],
    reason: 'Preview'
  }
  const expected = storage.graph.previewChangeSet(payload)
  const response = await app.inject({
    method: 'POST',
    url: '/api/artifacts/change-sets/preview',
    payload
  })
  assert.equal(response.statusCode, 200, response.body)
  assert.deepEqual(response.json(), expected)
  assert.equal(storage.get(b.id).status, 'draft')
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/artifacts/change-sets/commit',
        payload
      })
    ).statusCode,
    404
  )
})

test('session assignments use the server registry and survive session deletion as historical links', async t => {
  const { app, storage } = await setup(t)
  const response = await app.inject({
    method: 'POST',
    url: '/api/agent/sessions',
    payload: { presetId: 'fake', name: 'Linked session' }
  })
  assert.equal(response.statusCode, 201, response.body)
  const session = response.json()
  const task = storage.tasks.create(
    'task',
    { title: 'Task', externalUrl: null, state: 'open' },
    { kind: 'user', id: 'local' }
  )
  const assigned = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/sessions/${session.id}`,
    payload: { requestId: 'link', expectedVersion: 0, taskIds: [task.id] }
  })
  assert.equal(assigned.statusCode, 200, assigned.body)
  assert.deepEqual(assigned.json(), storage.tasks.assignment(session.id))
  const list = await app.inject('/api/agent/sessions')
  assert.deepEqual(
    list.json().find((entry: { id: string }) => entry.id === session.id)
      .taskIds,
    [task.id]
  )
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/agent/sessions/${session.id}`
      })
    ).statusCode,
    204
  )
  const historical = await app.inject(`/api/tasks/${task.id}/sessions`)
  assert.equal(historical.statusCode, 200, historical.body)
  assert.deepEqual(historical.json(), storage.tasks.linksPage(task.id))
  assert.equal(historical.json().items[0].available, false)
  const history = await app.inject(`/api/tasks/${task.id}/sessions/history`)
  assert.equal(history.statusCode, 200, history.body)
  assert.deepEqual(history.json(), storage.tasks.linkHistoryPage(task.id))
})

test('new read and write routes require the existing device access and same-origin checks', async t => {
  const { app } = await setup(t)
  for (const [method, url, payload] of [
    ['GET', '/api/tasks', undefined],
    ['GET', '/api/artifact-types', undefined],
    [
      'POST',
      '/api/tasks',
      {
        requestId: 'x',
        input: { title: 'Task', externalUrl: null, state: 'open' }
      }
    ],
    ['POST', '/api/artifacts/change-sets/preview', {}]
  ] as const) {
    const result = await app.inject({
      method,
      url,
      payload,
      remoteAddress: '192.0.2.10',
      headers: { host: 'evil.example' }
    })
    assert.equal(result.statusCode, 403, result.body)
  }
  const csrf = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: { host: 'localhost', origin: 'https://evil.example' },
    payload: {
      requestId: 'x',
      input: { title: 'Task', externalUrl: null, state: 'open' }
    }
  })
  assert.equal(csrf.statusCode, 403, csrf.body)
})

test('definition lists search by name and identifier, and cursors stay bound to the search', async t => {
  const { app, storage } = await setup(t)
  for (const title of ['Alpha one', 'Alpha two', 'Beta']) {
    storage.tasks.create(
      `create-${title}`,
      { title, externalUrl: null, state: 'open' },
      { kind: 'user', id: 'local' }
    )
  }
  const found = await app.inject('/api/tasks?search=ALPHA&limit=1')
  assert.equal(found.statusCode, 200, found.body)
  assert.equal(found.json().items.length, 1)
  const cursor = found.json().nextCursor
  assert.ok(cursor)
  const next = await app.inject(
    `/api/tasks?search=alpha&limit=1&cursor=${encodeURIComponent(cursor)}`
  )
  assert.deepEqual(
    [...found.json().items, ...next.json().items]
      .map((item: { title: string }) => item.title)
      .sort(),
    ['Alpha one', 'Alpha two']
  )
  assert.equal(next.json().nextCursor, null)
  const other = await app.inject(
    `/api/tasks?search=beta&limit=1&cursor=${encodeURIComponent(cursor)}`
  )
  assert.equal(other.statusCode, 400, other.body)
  const all = await app.inject('/api/tasks')
  assert.equal(all.json().items.length, 3)
  const byId = await app.inject('/api/artifact-types?search=custom-missing')
  assert.deepEqual(byId.json().items, [])
  const types = await app.inject('/api/artifact-types?search=ADR')
  assert.ok(types.json().items.length > 0)
})

test('task description and links round-trip, and legacy externalUrl input folds into links', async t => {
  const { app } = await setup(t)
  const created = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      requestId: 'rich',
      input: {
        title: 'Rich',
        state: 'open',
        description: '# Plan\n\nText',
        links: [
          { url: 'https://example.org/1', label: ' Issue ' },
          { url: 'https://example.org/2' }
        ]
      }
    }
  })
  assert.equal(created.statusCode, 200, created.body)
  assert.deepEqual(created.json(), {
    storeId: created.json().storeId,
    id: created.json().id,
    version: 1,
    createdAt: created.json().createdAt,
    title: 'Rich',
    state: 'open',
    description: '# Plan\n\nText',
    links: [
      { url: 'https://example.org/1', label: 'Issue' },
      { url: 'https://example.org/2' }
    ],
    tags: []
  })
  // Omitted description and links keep the current values.
  const renamed = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${created.json().id}`,
    payload: {
      requestId: 'rename',
      expectedVersion: 1,
      input: { title: 'Renamed', state: 'open' }
    }
  })
  assert.equal(renamed.statusCode, 200, renamed.body)
  assert.equal(renamed.json().description, '# Plan\n\nText')
  assert.equal(renamed.json().links.length, 2)
  const legacy = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      requestId: 'legacy',
      input: {
        title: 'Legacy',
        state: 'open',
        externalUrl: 'https://example.org/legacy'
      }
    }
  })
  assert.deepEqual(legacy.json().links, [{ url: 'https://example.org/legacy' }])
  assert.equal(legacy.json().description, '')
  const cleared = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${legacy.json().id}`,
    payload: {
      requestId: 'legacy-clear',
      expectedVersion: 1,
      input: { title: 'Legacy', state: 'open', externalUrl: null }
    }
  })
  assert.deepEqual(cleared.json().links, [])
})

test('task links reject bad URLs, duplicates and mixing with externalUrl', async t => {
  const { app } = await setup(t)
  const create = (requestId: string, input: object) =>
    app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { requestId, input: { title: 'T', state: 'open', ...input } }
    })
  for (const [name, input] of [
    ['credentials', { links: [{ url: 'https://u:p@example.org/' }] }],
    ['scheme', { links: [{ url: 'file:///etc/passwd' }] }],
    [
      'duplicate',
      { links: [{ url: 'https://a.org/' }, { url: 'https://a.org/' }] }
    ],
    ['both', { links: [], externalUrl: 'https://a.org/' }]
  ] as const) {
    const response = await create(name, input)
    assert.equal(response.statusCode, 400, `${name}: ${response.body}`)
  }
})

test('a closed task cannot be reopened or edited, and the task list filters by state', async t => {
  const { app } = await setup(t)
  const create = async (requestId: string, title: string) =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { requestId, input: { title, state: 'open' } }
      })
    ).json()
  const first = await create('a', 'Alpha')
  await create('b', 'Beta')
  const closed = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${first.id}`,
    payload: {
      requestId: 'close',
      expectedVersion: 1,
      input: { title: 'Alpha', state: 'closed' }
    }
  })
  assert.equal(closed.statusCode, 200, closed.body)
  for (const [requestId, input] of [
    ['reopen', { title: 'Alpha', state: 'open' }],
    ['edit', { title: 'Changed', state: 'closed' }]
  ] as const) {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${first.id}`,
      payload: { requestId, expectedVersion: 2, input }
    })
    assert.equal(response.statusCode, 409, response.body)
  }
  const only = async (state: string) =>
    (await app.inject({ method: 'GET', url: `/api/tasks?state=${state}` }))
      .json()
      .items.map((item: { title: string }) => item.title)
  assert.deepEqual(await only('closed'), ['Alpha'])
  assert.deepEqual(await only('open'), ['Beta'])
})

test('a snapshot saved before descriptions existed reads with links and an empty description', async t => {
  const { app, storage, db } = await setup(t)
  const id = '11111111-1111-4111-8111-111111111111'
  db.prepare('INSERT INTO task_current VALUES(?,?,?)').run(
    storage.storeId,
    id,
    JSON.stringify({
      storeId: storage.storeId,
      id,
      version: 1,
      title: 'Old',
      state: 'open',
      externalUrl: 'https://example.org/old'
    })
  )
  const response = await app.inject({ method: 'GET', url: `/api/tasks/${id}` })
  assert.equal(response.statusCode, 200, response.body)
  assert.deepEqual(response.json().links, [{ url: 'https://example.org/old' }])
  assert.equal(response.json().description, '')
  assert.equal('externalUrl' in response.json(), false)
})

test('a user binds and unbinds an artifact through the metadata route, and the task lists it', async t => {
  const { app, storage } = await setup(t)
  const actor = { kind: 'user' as const, id: 'local' }
  const task = storage.tasks.create(
    'bind-task',
    { title: 'Bound', state: 'open' },
    actor
  )
  const artifact = storage.create(
    {
      requestId: 'bind-artifact',
      body: 'Body',
      metadata: { title: 'Doc', tags: [] }
    },
    actor
  )
  const patch = (
    requestId: string,
    expectedVersion: number,
    taskIds: string[]
  ) =>
    app.inject({
      method: 'PATCH',
      url: `/api/artifacts/${artifact.id}/metadata`,
      payload: {
        requestId,
        expectedVersion,
        metadata: { title: 'Doc', tags: [], taskIds }
      }
    })
  const bound = await patch('bind', 1, [task.id])
  assert.equal(bound.statusCode, 200, bound.body)
  assert.deepEqual(bound.json().taskIds, [task.id])
  const listed = await app.inject({
    method: 'GET',
    url: `/api/tasks/${task.id}/artifacts`
  })
  assert.deepEqual(listed.json(), {
    taskId: task.id,
    items: [
      {
        id: artifact.id,
        title: 'Doc',
        typeId: 'generic',
        status: 'draft',
        createdAt: artifact.createdAt,
        exclusive: true
      }
    ]
  })
  const stale = await patch('stale', 1, [])
  assert.equal(stale.statusCode, 409, stale.body)
  const unbound = await patch('unbind', 2, [])
  assert.equal(unbound.statusCode, 200, unbound.body)
  const empty = await app.inject({
    method: 'GET',
    url: `/api/tasks/${task.id}/artifacts`
  })
  assert.deepEqual(empty.json().items, [])
})

test('task tags round-trip, stay on omitted updates, and filter the list by all or any', async t => {
  const { app } = await setup(t)
  const create = async (requestId: string, title: string, tags: string[]) =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { requestId, input: { title, state: 'open', tags } }
      })
    ).json()
  const first = await create('a', 'Alpha', ['ui', 'bug'])
  await create('b', 'Beta', ['ui'])
  await create('c', 'Gamma', [])
  assert.deepEqual(first.tags, ['ui', 'bug'])
  const renamed = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${first.id}`,
    payload: {
      requestId: 'rename',
      expectedVersion: 1,
      input: { title: 'Alpha 2', state: 'open' }
    }
  })
  assert.deepEqual(renamed.json().tags, ['ui', 'bug'])
  const titles = async (query: string) =>
    (await app.inject({ method: 'GET', url: `/api/tasks?${query}` }))
      .json()
      .items.map((item: { title: string }) => item.title)
      .sort()
  assert.deepEqual(await titles('tags=ui'), ['Alpha 2', 'Beta'])
  assert.deepEqual(await titles('tags=ui&tags=bug'), ['Alpha 2'])
  assert.deepEqual(await titles('tags=bug&tags=other&tagMode=any'), ['Alpha 2'])
  assert.deepEqual(await titles('tags=bug&tags=other'), [])
})

test('task list serializes live artifact counts including shared artifacts and empty tasks', async t => {
  const { app, storage } = await setup(t)
  const actor = { kind: 'user' as const, id: 'local' }
  const first = storage.tasks.create(
    'count-first',
    { title: 'First', state: 'open' },
    actor
  )
  const second = storage.tasks.create(
    'count-second',
    { title: 'Second', state: 'open' },
    actor
  )
  const empty = storage.tasks.create(
    'count-empty',
    { title: 'Empty', state: 'closed' },
    actor
  )
  const own = storage.create(
    {
      requestId: 'count-own',
      body: 'Own',
      metadata: { title: 'Own', tags: [], taskIds: [first.id] }
    },
    actor
  )
  storage.create(
    {
      requestId: 'count-shared',
      body: 'Shared',
      metadata: { title: 'Shared', tags: [], taskIds: [first.id, second.id] }
    },
    actor
  )
  const counts = async () => {
    const response = await app.inject('/api/tasks')
    assert.equal(response.statusCode, 200, response.body)
    return new Map(
      response
        .json()
        .items.map((item: { id: string; artifactCount: number }) => [
          item.id,
          item.artifactCount
        ])
    )
  }
  assert.deepEqual(
    await counts(),
    new Map([
      [first.id, 2],
      [second.id, 1],
      [empty.id, 0]
    ])
  )
  const unbound = await app.inject({
    method: 'PATCH',
    url: `/api/artifacts/${own.id}/metadata`,
    payload: {
      requestId: 'count-unbind',
      expectedVersion: own.metadataVersion,
      metadata: { title: own.title, tags: [], taskIds: [] }
    }
  })
  assert.equal(unbound.statusCode, 200, unbound.body)
  assert.deepEqual(
    await counts(),
    new Map([
      [first.id, 1],
      [second.id, 1],
      [empty.id, 0]
    ])
  )
})
