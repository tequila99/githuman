import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildApp } from '../../../src/server/app.ts'
import { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance } from 'fastify'
import {
  createFileDatabase,
  createTestDatabase
} from '../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'
import type { AgentSessionRegistry } from '../../../src/server/services/agent/session-registry.ts'
import type { Artifact } from '../../../src/shared/artifacts/types.ts'
import { ArtifactLifecycleService } from '../../../src/server/services/artifact-lifecycle.service.ts'
import { artifactBusyError } from '../../../src/server/errors/artifacts.ts'

// A fixed user identity matches a local browser request.
const USER = { kind: 'user' as const, id: 'local' }
// Enough ticks for the settle listener and the apply step to run.
const SETTLE_MS = 20

async function setup(
  t: TestContext,
  options: {
    file?: boolean
    beforeReady?: (app: FastifyInstance) => void
  } = {}
) {
  const root = mkdtempSync(join(tmpdir(), 'ght-transition-'))
  const path = join(root, '.githuman/ght-reviews.db')
  const db = options.file ? createFileDatabase(path) : createTestDatabase()
  let now = Date.now()
  const storage = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    now: () => now
  })
  const sessions = new Map<string, { id: string; status: string }>()
  const registry = {
    listPresets: () => [
      { id: 'test', available: true },
      { id: 'off', available: false }
    ],
    create() {
      const value = {
        id: randomUUID(),
        status: 'ready',
        onEvent: () => () => {},
        prompt: () => {}
      }
      sessions.set(value.id, value)
      return value
    },
    get: (id: string) => sessions.get(id),
    close(id: string) {
      const session = sessions.get(id)
      if (session) {
        session.status = 'closed'
      }
      return true
    },
    notifyArtifactActionsChanged() {}
  } as unknown as AgentSessionRegistry
  storage.lifecycle.attachSessions(registry)
  const app = buildApp({
    repositoryPath: root,
    db,
    artifacts: storage,
    allowedHosts: ['lan.test']
  })
  options.beforeReady?.(app)
  await app.ready()
  t.after(async () => {
    await app.close()
    db.close()
    rmSync(root, { force: true, recursive: true })
  })
  const transitions = storage.lifecycle.transitions
  function create(
    status: Artifact['status'] = 'draft',
    relations: Artifact['relations'] = []
  ) {
    const value = storage.create(
      {
        requestId: randomUUID(),
        body: 'Text of the document\n'.repeat(50),
        metadata: { title: 'Document', tags: [], relations }
      },
      USER
    )
    if (status === 'draft') {
      return value
    }
    const next = { ...value, status, metadataVersion: 2 }
    storage.catalog.transaction(() =>
      storage.catalog.appendMetadata(
        next,
        randomUUID(),
        USER,
        'metadata_updated'
      )
    )
    return next
  }
  function begin(artifact: Artifact, target: Artifact['status']) {
    const preview = transitions.preview(artifact.id, target, USER)
    const operation = transitions.begin(
      {
        previewId: preview.previewId,
        presetId: 'test',
        requestId: randomUUID()
      },
      USER
    )
    return { preview, operation }
  }
  function submit(validationId: string, verdict: 'pass' | 'conflict' = 'pass') {
    const view = storage.lifecycle.jobs.get(validationId)
    const sessionId = view.validatorSessionId!
    const value = storage.lifecycle.repository.validation(validationId)
    for (const key of value.manifest.requiredContentIds) {
      let offset = 0
      for (;;) {
        const chunk = storage.lifecycle.jobs.read(
          validationId,
          sessionId,
          key,
          offset
        )
        if (chunk.nextOffset === null) {
          break
        }
        offset = chunk.nextOffset
      }
    }
    return storage.lifecycle.jobs.submit(validationId, sessionId, {
      verdict,
      findings: [],
      resolutions: []
    })
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, SETTLE_MS))
  return {
    path,
    db,
    now: () => now,
    storage,
    app,
    transitions,
    create,
    begin,
    submit,
    settle,
    advance: (ms: number) => {
      now += ms
    }
  }
}

test('menu offers only user-selectable transitions', async t => {
  const { transitions, create } = await setup(t)
  const draft = transitions.options(create('draft').id)
  assert.equal(draft.status, 'draft')
  assert.deepEqual(
    draft.targets.map(item => item.status),
    ['accepted', 'archived', 'deleted']
  )
  const review = transitions.options(create('in_review').id)
  assert.ok(!review.targets.some(item => item.status === 'in_review'))
  assert.ok(review.targets.some(item => item.status === 'rejected'))
  const superseded = transitions.options(create('superseded').id)
  assert.deepEqual(
    superseded.targets.map(item => item.status),
    ['archived', 'deleted']
  )
})

test('one confirmation validates and applies the change after a pass', async t => {
  const { storage, transitions, create, begin, submit, settle } = await setup(t)
  const draft = create('draft')
  const { preview, operation } = begin(draft, 'accepted')
  assert.equal(preview.canConfirm, true)
  assert.deepEqual(
    preview.changes.map(item => [item.fromStatus, item.toStatus]),
    [['draft', 'accepted']]
  )
  assert.equal(operation.stage, 'validating')
  assert.equal(operation.canCancel, true)
  assert.equal(storage.get(draft.id).status, 'draft')
  submit(operation.validationId!)
  await settle()
  const done = transitions.operation(operation.id)
  assert.equal(done.stage, 'succeeded', done.reason ?? '')
  assert.equal(done.canCancel, false)
  assert.equal(storage.get(draft.id).status, 'accepted')
  assert.equal(transitions.options(draft.id).activeOperationId, null)
})

test('a conflict verdict leaves statuses unchanged', async t => {
  const { storage, transitions, create, begin, submit, settle } = await setup(t)
  const draft = create('draft')
  const { operation } = begin(draft, 'archived')
  submit(operation.validationId!, 'conflict')
  await settle()
  const done = transitions.operation(operation.id)
  assert.equal(done.stage, 'failed')
  assert.equal(done.verdict, 'conflict')
  assert.equal(storage.get(draft.id).status, 'draft')
})

test('cancel before applying stops the validator and keeps statuses', async t => {
  const { storage, transitions, create, begin } = await setup(t)
  const draft = create('draft')
  const { operation } = begin(draft, 'deleted')
  const cancelled = transitions.cancel(operation.id)
  assert.equal(cancelled.stage, 'cancelled')
  assert.equal(storage.get(draft.id).status, 'draft')
  assert.equal(storage.lifecycle.repository.lease(), undefined)
  assert.equal(transitions.cancel(operation.id).stage, 'cancelled')
})

test('cancel after success is a no-op and never reverts the change', async t => {
  const { storage, transitions, create, begin, submit, settle } = await setup(t)
  const draft = create('draft')
  const { operation } = begin(draft, 'accepted')
  submit(operation.validationId!)
  await settle()
  assert.equal(transitions.cancel(operation.id).stage, 'succeeded')
  assert.equal(storage.get(draft.id).status, 'accepted')
})

test('replay returns the same operation and a changed payload conflicts', async t => {
  const { transitions, create } = await setup(t)
  const draft = create('draft')
  const preview = transitions.preview(draft.id, 'archived', USER)
  const input = {
    previewId: preview.previewId,
    presetId: 'test',
    requestId: randomUUID()
  }
  const first = transitions.begin(input, USER)
  assert.equal(transitions.begin(input, USER).id, first.id)
  assert.throws(
    () => transitions.begin({ ...input, presetId: 'other' }, USER),
    /reused/
  )
})

test('unknown preset, stale preview and busy artifact start nothing', async t => {
  const { storage, transitions, create } = await setup(t)
  const draft = create('draft')
  const preview = transitions.preview(draft.id, 'archived', USER)
  assert.throws(
    () =>
      transitions.begin(
        { previewId: preview.previewId, presetId: 'missing', requestId: 'r1' },
        USER
      ),
    /unknown/
  )
  assert.throws(
    () =>
      transitions.begin(
        { previewId: preview.previewId, presetId: 'off', requestId: 'r1b' },
        USER
      ),
    /unavailable/
  )
  assert.throws(
    () =>
      transitions.begin(
        { previewId: randomUUID(), presetId: 'test', requestId: 'r2' },
        USER
      ),
    /expired or is unknown/
  )
  const next = { ...draft, tags: ['changed'], metadataVersion: 2 }
  storage.catalog.transaction(() =>
    storage.catalog.appendMetadata(next, randomUUID(), USER, 'metadata_updated')
  )
  assert.throws(
    () =>
      transitions.begin(
        { previewId: preview.previewId, presetId: 'test', requestId: 'r3' },
        USER
      ),
    /changed/
  )
  assert.equal(storage.lifecycle.repository.lease(), undefined)
})

test('a second operation is refused while one validation runs', async t => {
  const { transitions, create, begin } = await setup(t)
  begin(create('draft'), 'archived')
  const other = create('draft')
  const preview = transitions.preview(other.id, 'archived', USER)
  assert.throws(
    () =>
      transitions.begin(
        { previewId: preview.previewId, presetId: 'test', requestId: 'r4' },
        USER
      ),
    /active/
  )
})

test('an expired consent fails the operation without changing statuses', async t => {
  const { storage, transitions, create, begin, submit, settle, advance } =
    await setup(t)
  const draft = create('draft')
  const { operation } = begin(draft, 'accepted')
  submit(operation.validationId!)
  advance(16 * 60_000)
  await settle()
  const done = transitions.operation(operation.id)
  assert.equal(done.stage, 'failed')
  assert.match(done.reason ?? '', /consent expired/)
  assert.equal(storage.get(draft.id).status, 'draft')
})

test('a revoked device stops the application', async t => {
  const { storage, transitions, create, begin, submit, settle } = await setup(t)
  const draft = create('draft')
  const { operation } = begin(draft, 'accepted')
  transitions.setActorGuard(() => false)
  submit(operation.validationId!)
  await settle()
  const done = transitions.operation(operation.id)
  assert.equal(done.stage, 'failed')
  assert.match(done.reason ?? '', /Access/)
  assert.equal(storage.get(draft.id).status, 'draft')
})

test('active supplements block the preview with an explanation', async t => {
  const { transitions, create } = await setup(t)
  const base = create('accepted')
  create('accepted', [{ kind: 'supplements', targetId: base.id }])
  const preview = transitions.preview(base.id, 'archived', USER)
  assert.equal(preview.canConfirm, false)
  assert.ok(preview.blockers.length > 0)
  assert.throws(
    () =>
      transitions.begin(
        { previewId: preview.previewId, presetId: 'test', requestId: 'r5' },
        USER
      ),
    /blocked/
  )
})

test('shutdown marks unfinished operations interrupted and never applies', async t => {
  const { storage, transitions, create, begin } = await setup(t)
  const draft = create('draft')
  const { operation } = begin(draft, 'accepted')
  transitions.stop()
  assert.equal(transitions.operation(operation.id).stage, 'interrupted')
  assert.equal(storage.get(draft.id).status, 'draft')
})

test('operation events are append-only and the projection rebuilds', async t => {
  const { db, transitions, create, begin, submit, settle } = await setup(t)
  const { operation } = begin(create('draft'), 'accepted')
  submit(operation.validationId!)
  await settle()
  const repo = transitions.repository
  const before = repo.operation(operation.id)
  assert.ok(repo.history(operation.id).length >= 3)
  repo.rebuild()
  assert.deepEqual(repo.operation(operation.id), before)
  assert.throws(
    () => db.exec("UPDATE artifact_transition_events SET payload_json='x'"),
    /immutable/
  )
  assert.throws(
    () => db.exec('DELETE FROM artifact_transition_consents'),
    /immutable/
  )
})

test('HTTP routes drive the same flow for a local user', async t => {
  const { app, create, submit, settle, storage } = await setup(t)
  const draft = create('draft')
  const options = await app.inject({
    url: `/api/artifacts/${draft.id}/transitions`
  })
  assert.equal(options.statusCode, 200, options.body)
  const preview = await app.inject({
    method: 'POST',
    url: `/api/artifacts/${draft.id}/transition-previews`,
    payload: { targetStatus: 'accepted' }
  })
  assert.equal(preview.statusCode, 200, preview.body)
  const started = await app.inject({
    method: 'POST',
    url: '/api/artifact-transition-operations',
    payload: {
      previewId: preview.json().previewId,
      presetId: 'test',
      requestId: randomUUID()
    }
  })
  assert.equal(started.statusCode, 200, started.body)
  assert.equal(started.json().stage, 'validating')
  submit(started.json().validationId)
  await settle()
  const read = await app.inject({
    url: `/api/artifact-transition-operations/${started.json().id}`
  })
  assert.equal(read.json().stage, 'succeeded')
  const list = await app.inject({
    url: `/api/artifacts/${draft.id}/transition-operations`
  })
  assert.equal(list.json().items.length, 1)
  assert.equal(storage.get(draft.id).status, 'accepted')
  const late = await app.inject({
    method: 'POST',
    url: `/api/artifact-transition-operations/${started.json().id}/cancel`
  })
  assert.equal(late.json().stage, 'succeeded')
})

test('cancel that lands after pass but before apply wins', async t => {
  const { storage, transitions, create, begin, submit, settle } = await setup(t)
  const draft = create('draft')
  const { operation } = begin(draft, 'accepted')
  let calls = 0
  transitions.setActorGuard(() => {
    // The early gate runs just before the apply transaction starts.
    if (calls++ === 0) {
      transitions.cancel(operation.id)
    }
    return true
  })
  submit(operation.validationId!)
  await settle()
  assert.equal(transitions.operation(operation.id).stage, 'cancelled')
  assert.equal(storage.get(draft.id).status, 'draft')
})

test('cancel is refused while the change is being applied', async t => {
  const { storage, transitions, create, begin } = await setup(t)
  const { operation } = begin(create('draft'), 'accepted')
  storage.catalog.transaction(() =>
    transitions.repository.append({
      ...transitions.repository.operation(operation.id),
      stage: 'applying'
    })
  )
  assert.throws(() => transitions.cancel(operation.id), /no longer possible/)
  assert.equal(transitions.operation(operation.id).canCancel, false)
})

test('an incomplete validation fails the operation and keeps statuses', async t => {
  const { storage, transitions, create, begin, settle } = await setup(t)
  const draft = create('draft')
  const { operation } = begin(draft, 'accepted')
  storage.lifecycle.jobs.finish(
    operation.validationId!,
    'incomplete',
    'Validation timed out.'
  )
  await settle()
  const done = transitions.operation(operation.id)
  assert.equal(done.stage, 'failed')
  assert.match(done.reason ?? '', /timed out/)
  assert.equal(storage.get(draft.id).status, 'draft')
})

test('a document change between pass and apply stops the operation', async t => {
  const { storage, transitions, create, begin, submit, settle } = await setup(t)
  const draft = create('draft')
  const { operation } = begin(draft, 'accepted')
  submit(operation.validationId!)
  const changed = { ...draft, tags: ['late'], metadataVersion: 2 }
  storage.catalog.transaction(() =>
    storage.catalog.appendMetadata(
      changed,
      randomUUID(),
      USER,
      'metadata_updated'
    )
  )
  await settle()
  const done = transitions.operation(operation.id)
  assert.equal(done.stage, 'failed')
  assert.equal(storage.get(draft.id).status, 'draft')
})

test('losing access between the early gate and the commit rolls everything back', async t => {
  const { storage, transitions, create, begin, submit, settle } = await setup(t)
  const draft = create('draft')
  const { operation } = begin(draft, 'accepted')
  let calls = 0
  transitions.setActorGuard(() => calls++ === 0)
  submit(operation.validationId!)
  await settle()
  const done = transitions.operation(operation.id)
  assert.equal(done.stage, 'failed')
  assert.match(done.reason ?? '', /Access/)
  assert.equal(storage.get(draft.id).status, 'draft')
})

test('replaying a finished operation returns the stored result', async t => {
  const { transitions, create, submit, settle } = await setup(t)
  const draft = create('draft')
  const preview = transitions.preview(draft.id, 'accepted', USER)
  const input = {
    previewId: preview.previewId,
    presetId: 'test',
    requestId: randomUUID()
  }
  const first = transitions.begin(input, USER)
  submit(first.validationId!)
  await settle()
  const replay = transitions.begin(input, USER)
  assert.equal(replay.id, first.id)
  assert.equal(replay.stage, 'succeeded')
})

test('a busy database keeps the operation applying and the next pass commits it', async t => {
  const { storage, transitions, create, begin, submit, settle } = await setup(t)
  const draft = create('draft')
  const { operation } = begin(draft, 'accepted')
  const original = storage.lifecycle.commitConfirmed.bind(storage.lifecycle)
  let calls = 0
  t.mock.method(
    storage.lifecycle,
    'commitConfirmed',
    (...args: Parameters<typeof original>) => {
      if (calls++ === 0) {
        throw artifactBusyError('Artifact database is busy.')
      }
      return original(...args)
    }
  )
  submit(operation.validationId!)
  await settle()
  assert.equal(transitions.operation(operation.id).stage, 'applying')
  assert.equal(storage.get(draft.id).status, 'draft')
  transitions.reconcile()
  assert.equal(transitions.operation(operation.id).stage, 'succeeded')
  assert.equal(storage.get(draft.id).status, 'accepted')
})

test('a busy database does not outlive the consent', async t => {
  const { storage, transitions, create, begin, submit, settle, advance } =
    await setup(t)
  const { operation } = begin(create('draft'), 'accepted')
  t.mock.method(storage.lifecycle, 'commitConfirmed', () => {
    throw artifactBusyError('Artifact database is busy.')
  })
  submit(operation.validationId!)
  await settle()
  assert.equal(transitions.operation(operation.id).stage, 'applying')
  advance(16 * 60_000)
  transitions.reconcile()
  const done = transitions.operation(operation.id)
  assert.equal(done.stage, 'failed')
  assert.match(done.reason ?? '', /consent expired/)
})

test('a lost race for the validator lease is a conflict, not a result', async t => {
  const { storage, transitions, create, now, app } = await setup(t)
  const draft = create('draft')
  const preview = transitions.preview(draft.id, 'archived', USER)
  storage.lifecycle.repository.claim(
    'other-validation',
    'other-owner',
    now(),
    600_000
  )
  // Hide the lease from the early checks only; the claim itself still fails.
  t.mock.method(storage.lifecycle.repository, 'lease', () => undefined, {
    times: 2
  })
  const payload = {
    previewId: preview.previewId,
    presetId: 'test',
    requestId: 'race'
  }
  const response = await app.inject({
    method: 'POST',
    url: '/api/artifact-transition-operations',
    payload
  })
  assert.equal(response.statusCode, 409, response.body)
  assert.equal(response.json().code, 'GHT_ARTIFACT_CONFLICT')
  assert.match(response.json().message, /active/)
  const [stored] = transitions.list(draft.id).items
  assert.equal(stored.stage, 'failed')
  assert.equal(storage.get(draft.id).status, 'draft')
  const replay = await app.inject({
    method: 'POST',
    url: '/api/artifact-transition-operations',
    payload
  })
  assert.equal(replay.statusCode, 200, replay.body)
  assert.equal(replay.json().id, stored.id)
  assert.equal(replay.json().stage, 'failed')
  assert.equal(transitions.list(draft.id).items.length, 1)
})

test('a new preview replaces only the same document, target and actor', async t => {
  const { transitions, create } = await setup(t)
  const draft = create('draft')
  const first = transitions.preview(draft.id, 'archived', USER)
  const other = transitions.preview(draft.id, 'deleted', USER)
  const second = transitions.preview(draft.id, 'archived', USER)
  const start = (previewId: string, requestId: string) =>
    transitions.begin({ previewId, presetId: 'test', requestId }, USER)
  assert.throws(() => start(first.previewId, 'p1'), /expired or is unknown/)
  assert.equal(start(second.previewId, 'p2').targetStatus, 'archived')
  transitions.cancel(transitions.list(draft.id).items[0].id)
  assert.equal(start(other.previewId, 'p3').targetStatus, 'deleted')
})

test('heartbeat decides whether another owner is alive', async t => {
  const { db, storage, transitions, create, begin, now } = await setup(t)
  const second = new ArtifactLifecycleService(storage, db, now)
  const { operation } = begin(create('draft'), 'accepted')
  const owner = storage.lifecycle.jobs.ownerId
  const stale = () =>
    db
      .prepare('UPDATE artifact_owner_heartbeats SET beat_at=? WHERE owner=?')
      .run(now() - 31_000, owner)
  const stage = () => transitions.repository.operation(operation.id).stage

  // Fresh heartbeat: the other owner is alive and keeps its work.
  second.transitions.reconcile()
  assert.equal(stage(), 'validating')
  assert.ok(second.repository.lease())

  // No heartbeat row: old data keeps the old behavior (alive).
  db.prepare('DELETE FROM artifact_owner_heartbeats WHERE owner=?').run(owner)
  second.transitions.reconcile()
  assert.equal(stage(), 'validating')

  // Own owner is never dead, even with an old row.
  storage.lifecycle.repository.beat(owner, now(), 3_600_000)
  stale()
  assert.equal(storage.lifecycle.ownerAlive(owner, process.pid), true)

  // A stale heartbeat of another owner frees the lease and interrupts the work.
  assert.equal(second.ownerAlive(owner, process.pid), false)
  second.transitions.reconcile()
  assert.equal(stage(), 'interrupted')
  assert.equal(second.repository.lease(), undefined)
  assert.equal(storage.get(operation.artifactId).status, 'draft')
})

test('a dead process interrupts the operation and the grace period bounds a silent owner', async t => {
  const { db, storage, transitions, create, begin, now, advance } =
    await setup(t)
  const second = new ArtifactLifecycleService(storage, db, now)
  const { operation } = begin(create('draft'), 'accepted')
  const owner = storage.lifecycle.jobs.ownerId
  db.prepare('DELETE FROM artifact_owner_heartbeats WHERE owner=?').run(owner)
  advance(17 * 60_000)
  second.transitions.reconcile()
  assert.equal(
    transitions.repository.operation(operation.id).stage,
    'interrupted'
  )

  // A process id that no process can have is dead.
  assert.equal(second.ownerAlive('unknown-owner', 2 ** 22 + 1234567), false)
})

test('stop removes the heartbeat and a heartbeat never changes the store epoch', async t => {
  const { storage, transitions } = await setup(t)
  const owner = storage.lifecycle.jobs.ownerId
  const before = storage.catalog.epoch()
  transitions.reconcile()
  transitions.reconcile()
  assert.equal(storage.catalog.epoch(), before)
  assert.notEqual(storage.lifecycle.repository.heartbeat(owner), undefined)
  transitions.stop()
  assert.equal(storage.lifecycle.repository.heartbeat(owner), undefined)
})

test('agent keys and network callers cannot use any transition route', async t => {
  const { app, create } = await setup(t)
  const draft = create('draft')
  const id = draft.id
  const routes: ['GET' | 'POST', string, object | undefined][] = [
    ['GET', `/api/artifacts/${id}/transitions`, undefined],
    [
      'POST',
      `/api/artifacts/${id}/transition-previews`,
      { targetStatus: 'archived' }
    ],
    ['GET', `/api/artifacts/${id}/transition-operations`, undefined],
    [
      'POST',
      '/api/artifact-transition-operations',
      { previewId: id, presetId: 'test', requestId: 'x' }
    ],
    ['GET', `/api/artifact-transition-operations/${id}`, undefined],
    ['POST', `/api/artifact-transition-operations/${id}/cancel`, undefined]
  ]
  for (const [method, url, payload] of routes) {
    const response = await app.inject({
      method,
      url,
      headers: { host: 'lan.test', authorization: 'Bearer ' + 'a'.repeat(64) },
      remoteAddress: '192.168.1.20',
      ...(payload === undefined ? {} : { payload })
    })
    // The Host is allowed, so the refusal comes from the route access check.
    assert.ok(
      response.statusCode === 401,
      `${method} ${url} ${response.statusCode}`
    )
  }
})

for (const action of ['begin', 'cancel'] as const) {
  for (const timing of ['before request', 'before handler'] as const) {
    test(`a device revoked ${timing} cannot ${action} a transition`, async t => {
      let revokeId: string | null = null
      const { app, transitions, create, storage } = await setup(t, {
        beforeReady(server) {
          server.addHook('preHandler', async request => {
            if (request.headers['x-revoke-test'] && revokeId) {
              const response = await server.inject({
                method: 'DELETE',
                url: `/api/devices/${revokeId}`
              })
              assert.equal(response.statusCode, 204, response.body)
            }
          })
        }
      })
      const remote = {
        remoteAddress: '192.168.1.20',
        headers: { host: 'lan.test' }
      }
      const pending = await app.inject({
        ...remote,
        method: 'POST',
        url: '/api/devices/requests',
        payload: {}
      })
      assert.equal(pending.statusCode, 200, pending.body)
      const [device] = (await app.inject('/api/devices')).json<
        { id: string }[]
      >()
      const approved = await app.inject({
        method: 'POST',
        url: `/api/devices/${device.id}/approve`,
        payload: { code: pending.json().pairing.code }
      })
      assert.equal(approved.statusCode, 200, approved.body)
      const cookie = pending.cookies[0]
      const headers = {
        host: 'lan.test',
        cookie: `${cookie.name}=${cookie.value}`
      }
      const draft = create('draft')
      const previewResponse = await app.inject({
        ...remote,
        headers,
        method: 'POST',
        url: `/api/artifacts/${draft.id}/transition-previews`,
        payload: { targetStatus: 'archived' }
      })
      assert.equal(previewResponse.statusCode, 200, previewResponse.body)
      const payload = {
        previewId: previewResponse.json().previewId,
        presetId: 'test',
        requestId: randomUUID()
      }
      let operationId = ''
      if (action === 'cancel') {
        const started = await app.inject({
          ...remote,
          headers,
          method: 'POST',
          url: '/api/artifact-transition-operations',
          payload
        })
        assert.equal(started.statusCode, 200, started.body)
        operationId = started.json().id
      }
      if (timing === 'before request') {
        assert.equal(
          (
            await app.inject({
              method: 'DELETE',
              url: `/api/devices/${device.id}`
            })
          ).statusCode,
          204
        )
      } else {
        revokeId = device.id
      }
      const response = await app.inject({
        ...remote,
        headers: {
          ...headers,
          'x-revoke-test': timing === 'before handler' ? '1' : ''
        },
        method: 'POST',
        url:
          action === 'begin'
            ? '/api/artifact-transition-operations'
            : `/api/artifact-transition-operations/${operationId}/cancel`,
        ...(action === 'begin' ? { payload } : {})
      })
      assert.equal(response.statusCode, 401, response.body)
      assert.equal(storage.get(draft.id).status, 'draft')
      if (action === 'begin') {
        assert.equal(transitions.list(draft.id).items.length, 0)
      } else {
        assert.equal(transitions.operation(operationId).cancelRequested, false)
        transitions.cancel(operationId)
      }
    })
  }
}

test('a real SQLite writer lock retries applying exactly once after release', async t => {
  const { db, path, storage, transitions, create, begin, submit, settle } =
    await setup(t, { file: true })
  db.exec('PRAGMA busy_timeout=1')
  const writer = new DatabaseSync(path)
  t.after(() => writer.close())
  const draft = create('draft')
  const { operation, preview } = begin(draft, 'accepted')
  const commit = storage.lifecycle.commitConfirmed.bind(storage.lifecycle)
  let attempts = 0
  t.mock.method(
    storage.lifecycle,
    'commitConfirmed',
    (...args: Parameters<typeof commit>) => {
      if (attempts++ === 0) writer.exec('BEGIN IMMEDIATE')
      return commit(...args)
    }
  )
  try {
    submit(operation.validationId!)
    await settle()
    assert.equal(transitions.operation(operation.id).stage, 'applying')
    assert.equal(storage.get(draft.id).status, 'draft')
    assert.equal(
      transitions.repository
        .history(operation.id)
        .filter(item => item.stage === 'applying').length,
      1
    )
  } finally {
    if (writer.isTransaction) writer.exec('ROLLBACK')
  }
  transitions.reconcile()
  transitions.reconcile()
  assert.equal(attempts, 2)
  assert.equal(transitions.operation(operation.id).stage, 'succeeded')
  assert.equal(storage.get(draft.id).status, 'accepted')
  assert.equal(storage.get(draft.id).metadataVersion, draft.metadataVersion + 1)
  const history = transitions.repository.history(operation.id)
  assert.equal(history.filter(item => item.stage === 'applying').length, 1)
  assert.equal(history.filter(item => item.stage === 'succeeded').length, 1)
  assert.ok(preview.canConfirm)
})

test('a stalled preparation recovers and a busy operation does not stop its neighbours', async t => {
  const { storage, transitions, create, advance } = await setup(t)
  t.mock.method(storage.lifecycle.jobs, 'start', () => {
    throw new Error('start failed')
  })
  const append = transitions.repository.append.bind(transitions.repository)
  t.mock.method(
    transitions.repository,
    'append',
    (value: Parameters<typeof append>[0]) => {
      if (value.stage === 'failed') throw artifactBusyError('write blocked')
      append(value)
    }
  )
  for (let index = 0; index < 2; index++) {
    const doc = create()
    const preview = transitions.preview(doc.id, 'accepted', USER)
    assert.throws(
      () =>
        transitions.begin(
          {
            previewId: preview.previewId,
            presetId: 'test',
            requestId: randomUUID()
          },
          USER
        ),
      /blocked/
    )
  }
  t.mock.restoreAll()
  const [first, second] = transitions.repository.unfinished()
  advance(10_001)
  const validation = storage.lifecycle.repository.validation.bind(
    storage.lifecycle.repository
  )
  t.mock.method(storage.lifecycle.repository, 'validation', (id: string) => {
    if (id === first.validationId) throw artifactBusyError('one read blocked')
    return validation(id)
  })
  transitions.reconcile()
  assert.equal(transitions.operation(first.id).stage, 'preparing')
  assert.equal(transitions.operation(second.id).stage, 'failed')
  assert.match(transitions.operation(second.id).reason ?? '', /did not start/)
  t.mock.restoreAll()
  transitions.reconcile()
  assert.equal(transitions.operation(first.id).stage, 'failed')
})
