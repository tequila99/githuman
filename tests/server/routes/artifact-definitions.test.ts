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
  return { app, storage }
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
    ['/api/tasks', storage.tasks.list()],
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
