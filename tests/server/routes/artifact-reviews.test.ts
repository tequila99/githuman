import type { FastifyInstance } from 'fastify'
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildApp } from '../../../src/server/app.ts'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'
import { ArtifactReviewRepository } from '../../../src/server/repositories/artifact-review.repo.ts'
import type { VerifiedReviewUserCommand } from '../../../src/server/services/artifact-review-user-command.ts'
import { ForbiddenError } from '../../../src/server/errors/http.ts'
import {
  createEventBus,
  type ServerEvent
} from '../../../src/server/event-bus.ts'
import type {
  Artifact,
  ArtifactReviewDecisionInput,
  ArtifactReviewEvent,
  ArtifactMetadataInput
} from '../../../src/shared/artifacts/types.ts'

// Fixture status changes stand in for lifecycle commits that belong to stage 0092.
const ACTOR = { kind: 'user' as const, id: 'local' }

async function setup(
  t: TestContext,
  beforeReady?: (app: FastifyInstance) => void
) {
  const root = mkdtempSync(join(tmpdir(), 'ght-review-api-')),
    db = createTestDatabase()
  const eventBus = createEventBus(),
    events: ServerEvent[] = []
  const storage = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    eventBus
  })
  const app = buildApp({
    db,
    repositoryPath: root,
    artifacts: storage,
    eventBus,
    allowedHosts: ['review.test']
  })
  t.after(async () => {
    await app.close()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  const create = (
    revisionOf: string[] = [],
    metadata: Partial<ArtifactMetadataInput> = {}
  ) =>
    storage.create(
      {
        requestId: randomUUID(),
        body: 'Первая\r\nSecond',
        metadata: { title: 'Document', tags: [], ...metadata },
        revisionOf
      },
      ACTOR
    )
  const status = (id: string, value: Artifact['status']) =>
    storage.catalog.transaction(() => {
      const previous = storage.get(id)
      storage.catalog.appendMetadata(
        {
          ...previous,
          status: value,
          metadataVersion: previous.metadataVersion + 1
        },
        randomUUID(),
        ACTOR,
        'metadata_updated'
      )
    })
  const thread = (id: string, blocking = true) =>
    storage.reviews.createThread(
      id,
      { requestId: randomUUID(), text: 'Review', blocking },
      ACTOR
    )
  const decide = (
    id: string,
    version: number,
    artifactId: string,
    kind: ArtifactReviewDecisionInput['kind'] = 'resolved',
    blocking = false
  ) =>
    app.inject({
      method: 'POST',
      url: `/api/artifact-threads/${id}/decisions`,
      payload: {
        requestId: randomUUID(),
        expectedThreadVersion: version,
        kind,
        scope: {
          appliesToArtifactId: artifactId,
          includeRevisionDescendants: true
        },
        ...(kind === 'blocking_changed' ? { blocking } : {})
      }
    })
  beforeReady?.(app)
  await app.ready()
  eventBus.subscribe(event => events.push(event))
  return { root, db, app, storage, create, status, thread, decide, events }
}

test('review HTTP responses preserve every field of threads, events, decisions, history and state', async t => {
  const { app, storage, create, decide } = await setup(t)
  const artifact = create()
  const response = await app.inject({
    method: 'POST',
    url: `/api/artifacts/${artifact.id}/threads`,
    payload: {
      requestId: 'anchored',
      text: 'Comment',
      anchor: {
        artifactId: artifact.id,
        fileSha256: artifact.sha256,
        bodyStartLine: artifact.bodyStartLine,
        startLine: 1,
        endLine: 2,
        quote: 'Первая\r\nSecond'
      }
    }
  })
  assert.equal(response.statusCode, 200, response.body)
  const event = response.json<ArtifactReviewEvent>()
  assert.deepEqual(event, storage.reviews.history(event.threadId).items[0])
  assert.deepEqual(event.actor, ACTOR)
  const reply = await app.inject({
    method: 'POST',
    url: `/api/artifact-threads/${event.threadId}/events`,
    payload: {
      requestId: 'reply',
      expectedThreadVersion: 1,
      kind: 'replied',
      text: 'Reply'
    }
  })
  assert.equal(reply.statusCode, 200, reply.body)
  assert.deepEqual(
    reply.json(),
    storage.reviews.history(event.threadId).items[1]
  )
  for (const [kind, version] of [
    ['blocking_changed', 2],
    ['resolved', 3],
    ['reopened', 4]
  ] as const) {
    const result = await decide(
      event.threadId,
      version,
      artifact.id,
      kind,
      true
    )
    assert.equal(result.statusCode, 200, result.body)
    assert.deepEqual(
      result.json(),
      storage.reviews.history(event.threadId).items[version]
    )
  }
  const replyEvent = reply.json<ArtifactReviewEvent>()
  assert.equal(replyEvent.payload.kind, 'replied')
  for (const payload of [
    {
      requestId: 'edit-http',
      expectedThreadVersion: 5,
      kind: 'content_edited',
      commentId: replyEvent.payload.commentId,
      text: 'Edited reply'
    },
    {
      requestId: 'hide-http',
      expectedThreadVersion: 6,
      kind: 'hidden',
      commentId: replyEvent.payload.commentId
    }
  ]) {
    const result = await app.inject({
      method: 'POST',
      url: `/api/artifact-threads/${event.threadId}/events`,
      payload
    })
    assert.equal(result.statusCode, 200, result.body)
    assert.deepEqual(
      result.json(),
      storage.reviews.history(event.threadId).items[
        payload.expectedThreadVersion
      ]
    )
  }
  for (const [path, expected] of [
    [
      `/api/artifacts/${artifact.id}/threads`,
      storage.reviews.list(artifact.id)
    ],
    [
      `/api/artifacts/${artifact.id}/review-state`,
      storage.reviews.summary(artifact.id)
    ],
    [
      `/api/artifact-threads/${event.threadId}/history?limit=2`,
      storage.reviews.history(event.threadId, 0, 2)
    ]
  ] as const) {
    const result = await app.inject(path)
    assert.equal(result.statusCode, 200, result.body)
    assert.deepEqual(result.json(), expected)
    assert.equal(result.headers['cache-control'], 'no-store')
  }
})

test('structured user decisions resolve only their revision branch and reopen future descendants', async t => {
  const { storage, create, thread, decide } = await setup(t)
  const a = create(),
    b = create([a.id]),
    c = create([a.id]),
    d = create([b.id])
  const event = thread(a.id)
  const resolved = await decide(event.threadId, 1, b.id)
  assert.equal(resolved.statusCode, 200, resolved.body)
  assert.equal(storage.reviews.summary(b.id).blockerSummary.count, 0)
  assert.equal(storage.reviews.summary(c.id).blockerSummary.count, 1)
  assert.equal(storage.reviews.summary(a.id).blockerSummary.count, 1)
  assert.equal(storage.reviews.summary(d.id).blockerSummary.count, 0)
  const future = create([b.id])
  assert.equal(storage.reviews.summary(future.id).blockerSummary.count, 0)
  assert.equal(
    (await decide(event.threadId, 2, b.id, 'reopened')).statusCode,
    200
  )
  assert.equal(storage.reviews.summary(d.id).blockerSummary.count, 1)
  assert.equal(storage.reviews.summary(future.id).blockerSummary.count, 1)
  const unrelated = create()
  const before = storage.catalog.epoch()
  assert.equal((await decide(event.threadId, 3, unrelated.id)).statusCode, 400)
  assert.equal(storage.catalog.epoch(), before)
})

test('priority targets union open blockers from all historical lineages without revisionOf or duplicate threads', async t => {
  const { storage, create, status, thread, decide } = await setup(t)
  const ancestor = create(),
    left = create([ancestor.id]),
    right = create([ancestor.id])
  const old = thread(ancestor.id),
    own = thread(right.id)
  status(ancestor.id, 'deleted')
  const candidate = create([], {
    relations: [
      { kind: 'replaces', targetId: left.id },
      { kind: 'replaces', targetId: right.id }
    ]
  })
  assert.deepEqual(
    storage.reviews.summary(candidate.id).blockerSummary.threadIds.sort(),
    [old.threadId, own.threadId].sort()
  )
  assert.equal(storage.reviews.getThreads(candidate.id).length, 2)
  assert.equal(storage.reviews.getThreads(candidate.id, false).length, 0)
  assert.equal((await decide(old.threadId, 1, candidate.id)).statusCode, 200)
  assert.equal(storage.reviews.summary(candidate.id).blockerSummary.count, 1)
  assert.equal(storage.reviews.summary(left.id).blockerSummary.count, 1)
  assert.equal((await decide(own.threadId, 1, candidate.id)).statusCode, 200)
  assert.equal(storage.reviews.summary(candidate.id).blockerSummary.count, 0)
  assert.equal(storage.reviews.summary(right.id).blockerSummary.count, 2)
  assert.equal((await decide(old.threadId, 2, ancestor.id)).statusCode, 200)
  assert.equal(
    (await decide(old.threadId, 3, candidate.id, 'reopened')).statusCode,
    200
  )
  assert.equal(storage.reviews.summary(candidate.id).blockerSummary.count, 1)
  const supplement = create([], {
    relations: [{ kind: 'supplements', targetId: right.id }]
  })
  assert.equal(storage.reviews.summary(supplement.id).blockerSummary.count, 1)
})

test('new blockers create attention on accepted artifacts and validation epochs survive projection rebuilds', async t => {
  const { db, storage, create, status, thread, decide } = await setup(t)
  const a = create()
  status(a.id, 'accepted')
  const before = storage.catalog.validationEpoch()
  const event = thread(a.id)
  const state = storage.reviews.summary(a.id)
  assert.ok(state.validationEpoch > before)
  assert.deepEqual(state.blockerSummary, {
    count: 1,
    threadIds: [event.threadId],
    truncated: false,
    attention: true
  })
  assert.equal(storage.get(a.id).status, 'accepted')
  const epoch = state.validationEpoch
  storage.reviews.comment(
    event.threadId,
    {
      requestId: randomUUID(),
      expectedThreadVersion: 1,
      kind: 'content_edited',
      commentId: event.threadId,
      text: 'Edited blocker'
    },
    ACTOR
  )
  assert.ok(storage.catalog.validationEpoch() > epoch)
  const repo = new ArtifactReviewRepository(db, storage.catalog)
  storage.catalog.rebuild()
  repo.rebuild()
  assert.equal(storage.reviews.summary(a.id).blockerSummary.attention, true)
  assert.equal((await decide(event.threadId, 2, a.id)).statusCode, 200)
  assert.equal(storage.reviews.summary(a.id).blockerSummary.attention, false)
  assert.equal(storage.get(a.id).status, 'accepted')
})

test('isolated drafts, title and tags do not advance validationEpoch; graph and blocking changes do', async t => {
  const { storage, create, thread, decide } = await setup(t)
  const before = storage.catalog.validationEpoch(),
    a = create()
  assert.equal(storage.catalog.validationEpoch(), before)
  storage.updateMetadata(
    a.id,
    {
      requestId: randomUUID(),
      expectedVersion: 1,
      metadata: { title: 'Renamed', tags: ['tag'] }
    },
    ACTOR
  )
  assert.equal(storage.catalog.validationEpoch(), before)
  const ordinary = thread(a.id, false)
  assert.equal(storage.catalog.validationEpoch(), before)
  storage.reviews.comment(
    ordinary.threadId,
    {
      requestId: randomUUID(),
      kind: 'replied',
      expectedThreadVersion: 1,
      text: 'Reply'
    },
    ACTOR
  )
  assert.equal(storage.catalog.validationEpoch(), before)
  const b = create([a.id])
  assert.ok(storage.catalog.validationEpoch() > before)
  const withLineage = storage.catalog.validationEpoch()
  const task = storage.tasks.create(
    randomUUID(),
    { title: 'Task', state: 'open', externalUrl: null },
    ACTOR
  )
  const withTask = storage.catalog.validationEpoch()
  storage.updateMetadata(
    b.id,
    {
      requestId: randomUUID(),
      expectedVersion: 1,
      metadata: { title: 'B', tags: [], taskIds: [task.id] }
    },
    ACTOR
  )
  assert.ok(storage.catalog.validationEpoch() > withTask)
  assert.ok(withTask > withLineage)
  const beforeBlocking = storage.catalog.validationEpoch()
  assert.equal(
    (await decide(ordinary.threadId, 2, a.id, 'blocking_changed', true))
      .statusCode,
    200
  )
  assert.ok(storage.catalog.validationEpoch() > beforeBlocking)
})

test('concurrent resolve and blocking commands cannot overwrite the same expected version', async t => {
  const { storage, create, thread, decide } = await setup(t)
  const a = create(),
    event = thread(a.id)
  const result = await Promise.all([
    decide(event.threadId, 1, a.id),
    decide(event.threadId, 1, a.id, 'blocking_changed', false)
  ])
  assert.deepEqual(
    result
      .map(response => response.statusCode)
      .sort((left, right) => left - right),
    [200, 409]
  )
  assert.equal(storage.reviews.history(event.threadId).items.length, 2)
})

test('decisions reject forged authorization, missing versions, scopes and ordinary-command bypasses', async t => {
  const { app, storage, create, thread } = await setup(t)
  const a = create(),
    event = thread(a.id),
    url = `/api/artifact-threads/${event.threadId}/decisions`
  const payload = {
    requestId: randomUUID(),
    expectedThreadVersion: 1,
    kind: 'resolved',
    scope: { appliesToArtifactId: a.id, includeRevisionDescendants: true }
  }
  for (const patch of [
    { authorized: true },
    { actor: ACTOR },
    { userRequested: true },
    { expectedThreadVersion: undefined },
    { scope: undefined },
    { scope: { appliesToArtifactId: a.id, includeRevisionDescendants: false } }
  ]) {
    const result = await app.inject({
      method: 'POST',
      url,
      payload: { ...payload, ...patch }
    })
    assert.equal(result.statusCode, 400, result.body)
  }
  assert.throws(
    () => storage.reviews.decide({} as VerifiedReviewUserCommand),
    ForbiddenError
  )
  const ordinary = await app.inject({
    method: 'POST',
    url: `/api/artifact-threads/${event.threadId}/events`,
    payload
  })
  assert.equal(ordinary.statusCode, 400)
  assert.equal(storage.reviews.history(event.threadId).items.length, 1)
})

test('review endpoints preserve local/device auth and reject network credentials and cross-origin decisions', async t => {
  const { app, create, thread } = await setup(t)
  const a = create(),
    event = thread(a.id)
  const payload = {
    requestId: randomUUID(),
    expectedThreadVersion: 1,
    kind: 'resolved',
    scope: { appliesToArtifactId: a.id, includeRevisionDescendants: true }
  }
  for (const [method, url, body] of [
    ['GET', `/api/artifacts/${a.id}/threads`, undefined],
    ['GET', `/api/artifacts/${a.id}/review-state`, undefined],
    ['GET', `/api/artifact-threads/${event.threadId}/history`, undefined],
    ['POST', `/api/artifacts/${a.id}/threads`, { requestId: 'x', text: 'X' }],
    ['POST', `/api/artifact-threads/${event.threadId}/decisions`, payload]
  ] as const) {
    const response = await app.inject({
      method,
      url,
      payload: body,
      remoteAddress: '192.0.2.10',
      headers: { host: 'review.test', authorization: 'Bearer agent-key' }
    })
    assert.equal(response.statusCode, 401, response.body)
  }
  const csrf = await app.inject({
    method: 'POST',
    url: `/api/artifact-threads/${event.threadId}/decisions`,
    payload,
    headers: { host: 'localhost', origin: 'https://evil.test' }
  })
  assert.equal(csrf.statusCode, 403)
})

test('thread pages are complete, query-bound and invalidated by a committed change', async t => {
  const { app, storage, create, thread } = await setup(t)
  const a = create(),
    b = create([a.id])
  thread(a.id, false)
  thread(b.id)
  const page = storage.reviews.list(b.id, { limit: 1 })
  assert.equal(page.items.length, 1)
  assert.ok(page.nextCursor)
  const response = await app.inject(
    `/api/artifacts/${b.id}/threads?limit=1&cursor=${page.nextCursor}`
  )
  assert.equal(response.statusCode, 200, response.body)
  assert.deepEqual(
    response.json(),
    storage.reviews.list(b.id, { limit: 1, cursor: page.nextCursor })
  )
  const wrong = await app.inject(
    `/api/artifacts/${b.id}/threads?limit=1&includeInherited=false&cursor=${page.nextCursor}`
  )
  assert.equal(wrong.statusCode, 400)
  thread(b.id)
  const stale = await app.inject(
    `/api/artifacts/${b.id}/threads?limit=1&cursor=${page.nextCursor}`
  )
  assert.equal(stale.statusCode, 409)
})

test('a failure while committing a user decision rolls back review state, epochs, attention and SSE', async t => {
  const { db, storage, create, status, thread, decide, events } = await setup(t)
  const a = create()
  status(a.id, 'accepted')
  const event = thread(a.id)
  const before = storage.reviews.summary(a.id),
    count = events.length
  db.exec(
    `CREATE TRIGGER fail_decision BEFORE INSERT ON artifact_store_changes WHEN NEW.entity_kind='artifact_review' BEGIN SELECT RAISE(ABORT,'Injected decision failure'); END`
  )
  const result = await decide(event.threadId, 1, a.id)
  assert.equal(result.statusCode, 500)
  assert.deepEqual(storage.reviews.summary(a.id), before)
  assert.equal(storage.reviews.history(event.threadId).items.length, 1)
  assert.equal(events.length, count)
})

test('a paired device executes structured decisions with its own actor and loses access after revoke', async t => {
  let revokeId = ''
  const { app, storage, create, thread } = await setup(t, server => {
    server.addHook('preHandler', async request => {
      if (request.headers['x-revoke-review'] === '1') {
        const result = await server.inject({
          method: 'DELETE',
          url: `/api/devices/${revokeId}`
        })
        assert.equal(result.statusCode, 204, result.body)
      }
    })
  })
  const a = create(),
    event = thread(a.id)
  const remoteAddress = '192.0.2.10',
    host = 'review.test'
  const pending = await app.inject({
    method: 'POST',
    url: '/api/devices/requests',
    remoteAddress,
    headers: { host },
    payload: {}
  })
  assert.equal(pending.statusCode, 200, pending.body)
  const cookie = `${pending.cookies[0].name}=${pending.cookies[0].value}`
  const device = (await app.inject('/api/devices')).json<{ id: string }[]>()[0]
  const approved = await app.inject({
    method: 'POST',
    url: `/api/devices/${device.id}/approve`,
    payload: {
      code: pending.json<{ pairing: { code: string } }>().pairing.code
    }
  })
  assert.equal(approved.statusCode, 200, approved.body)
  const payload = {
    requestId: 'device-decision',
    expectedThreadVersion: 1,
    kind: 'resolved',
    scope: { appliesToArtifactId: a.id, includeRevisionDescendants: true }
  }
  const result = await app.inject({
    method: 'POST',
    url: `/api/artifact-threads/${event.threadId}/decisions`,
    remoteAddress,
    headers: { host, cookie, origin: 'http://review.test' },
    payload
  })
  assert.equal(result.statusCode, 200, result.body)
  assert.deepEqual(result.json<ArtifactReviewEvent>().actor, {
    kind: 'user',
    id: device.id
  })
  const epoch = storage.catalog.epoch(),
    validationEpoch = storage.catalog.validationEpoch()
  const replay = await app.inject({
    method: 'POST',
    url: `/api/artifact-threads/${event.threadId}/decisions`,
    remoteAddress,
    headers: { host, cookie },
    payload
  })
  assert.equal(replay.statusCode, 200, replay.body)
  assert.deepEqual(replay.json(), result.json())
  assert.equal(storage.catalog.epoch(), epoch)
  assert.equal(storage.catalog.validationEpoch(), validationEpoch)
  revokeId = device.id
  const denied = await app.inject({
    method: 'POST',
    url: `/api/artifact-threads/${event.threadId}/decisions`,
    remoteAddress,
    headers: { host, cookie, 'x-revoke-review': '1' },
    payload: {
      ...payload,
      requestId: 'after-revoke',
      expectedThreadVersion: 2,
      kind: 'reopened'
    }
  })
  assert.equal(denied.statusCode, 401, denied.body)
  assert.equal(storage.reviews.history(event.threadId).items.length, 2)
})

test('review fixes: transitive priority blockers survive revisions and resolve at intermediate scopes', async t => {
  const { storage, create, thread, decide } = await setup(t)
  const a = create(),
    b = create([], { relations: [{ kind: 'supplements', targetId: a.id }] })
  const c = create([], { relations: [{ kind: 'replaces', targetId: b.id }] }),
    d = create([b.id])
  const event = thread(a.id)
  for (const artifact of [a, b, c, d]) {
    assert.equal(storage.reviews.summary(artifact.id).blockerSummary.count, 1)
  }
  const result = await decide(event.threadId, 1, c.id)
  assert.equal(result.statusCode, 200, result.body)
  assert.equal(storage.reviews.summary(c.id).blockerSummary.count, 0)
  assert.equal(storage.reviews.summary(d.id).blockerSummary.count, 1)
  assert.equal((await decide(event.threadId, 2, b.id)).statusCode, 200)
  assert.equal(storage.reviews.summary(d.id).blockerSummary.count, 0)
  assert.equal(storage.reviews.summary(a.id).blockerSummary.count, 1)
})

test('review fixes: all paths must close and mixed lineage-priority cycles converge', async t => {
  const { storage, create, thread, decide, status } = await setup(t)
  const a = create(),
    left = create([], { relations: [{ kind: 'supplements', targetId: a.id }] })
  const right = create([], {
    relations: [{ kind: 'supplements', targetId: a.id }]
  })
  const top = create([], {
    relations: [
      { kind: 'replaces', targetId: left.id },
      { kind: 'replaces', targetId: right.id }
    ]
  })
  const event = thread(a.id)
  assert.equal((await decide(event.threadId, 1, left.id)).statusCode, 200)
  assert.equal(storage.reviews.summary(top.id).blockerSummary.count, 1)
  assert.equal((await decide(event.threadId, 2, right.id)).statusCode, 200)
  assert.equal(storage.reviews.summary(top.id).blockerSummary.count, 0)
  status(left.id, 'deleted')
  assert.equal(storage.reviews.summary(top.id).blockerSummary.count, 0)
  const base = create(),
    child = create([base.id])
  storage.updateMetadata(
    base.id,
    {
      requestId: randomUUID(),
      expectedVersion: 1,
      metadata: {
        title: 'Cycle',
        tags: [],
        relations: [
          { kind: 'replaces', targetId: child.id },
          { kind: 'supplements', targetId: top.id }
        ]
      }
    },
    ACTOR
  )
  assert.equal(storage.reviews.summary(child.id).blockerSummary.count, 0)
  assert.equal(
    (await decide(event.threadId, 3, right.id, 'reopened')).statusCode,
    200
  )
  assert.equal(storage.reviews.summary(child.id).blockerSummary.count, 1)
  assert.equal(storage.reviews.summary(base.id).blockerSummary.count, 1)
})

test('review fixes: latest applicable decision overrides a narrower reopen', async t => {
  const { storage, create, thread, decide } = await setup(t)
  const a = create(),
    b = create([a.id]),
    event = thread(a.id)
  assert.equal((await decide(event.threadId, 1, a.id)).statusCode, 200)
  assert.equal(
    (await decide(event.threadId, 2, b.id, 'reopened')).statusCode,
    200
  )
  assert.equal(storage.reviews.summary(b.id).blockerSummary.count, 1)
  assert.equal((await decide(event.threadId, 3, a.id)).statusCode, 200)
  assert.equal(storage.reviews.summary(b.id).blockerSummary.count, 0)
})

test('review fixes: comments endpoint serializes full anchor and hidden nulls with stable positions', async t => {
  const { app, storage, create, thread } = await setup(t)
  const a = create(),
    event = thread(a.id)
  storage.reviews.comment(
    event.threadId,
    {
      requestId: randomUUID(),
      expectedThreadVersion: 1,
      kind: 'hidden',
      commentId: event.threadId
    },
    ACTOR
  )
  const result = await app.inject(
    `/api/artifact-threads/${event.threadId}/comments?limit=1`
  )
  assert.equal(result.statusCode, 200, result.body)
  assert.deepEqual(
    result.json(),
    storage.reviews.comments(event.threadId, { limit: 1 })
  )
  assert.equal(result.json().items[0].text, null)
  const listed = await app.inject(`/api/artifacts/${a.id}/threads`)
  assert.deepEqual(listed.json(), storage.reviews.list(a.id))
  assert.equal(listed.json().items[0].rootComment.text, null)
  assert.equal('comments' in listed.json().items[0], false)
  assert.equal(
    (
      await app.inject(
        `/api/artifact-threads/${event.threadId}/comments?afterIndex=-1`
      )
    ).statusCode,
    400
  )
})
