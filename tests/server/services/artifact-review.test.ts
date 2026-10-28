import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from '@modelcontextprotocol/sdk/shared/stdio.js'
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createTestDatabase,
  createFileDatabase
} from '../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'
import {
  createEventBus,
  type ServerEvent
} from '../../../src/server/event-bus.ts'
import {
  ArtifactConflictError,
  ArtifactInputError,
  ArtifactIntegrityError,
  ArtifactNotFoundError,
  ArtifactTooLargeError
} from '../../../src/server/errors/artifacts.ts'
import { MAX_ARTIFACT_REVIEW_TEXT_BYTES } from '../../../src/shared/artifacts/constants.ts'
import type {
  Artifact,
  ArtifactReviewCommentInput,
  ArtifactReviewCreateInput,
  ArtifactSourceAnchor
} from '../../../src/shared/artifacts/types.ts'

// The transport assigns actors; command bodies never carry this identity.
const ACTOR = { kind: 'user' as const, id: 'local' }

function assertMcpSize(result: unknown): void {
  const envelope = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result
    }
  })
  assert.ok(Buffer.byteLength(envelope) < STDIO_DEFAULT_MAX_BUFFER_SIZE)
}

function setup(
  t: TestContext,
  body = 'Первая 🧪\r\nSecond\nLast\r',
  file = false
) {
  const root = mkdtempSync(join(tmpdir(), 'ght-review-service-'))
  const path = join(root, '.githuman/ght-reviews.db')
  const db = file ? createFileDatabase(path) : createTestDatabase()
  const eventBus = createEventBus(),
    events: ServerEvent[] = []
  let clock = Date.parse('2026-10-28T00:00:00.000Z')
  const storage = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    eventBus,
    now: () => clock
  })
  const artifact = storage.create(
    {
      requestId: randomUUID(),
      body,
      metadata: { title: 'Document', tags: [] }
    },
    ACTOR
  )
  eventBus.subscribe(event => events.push(event))
  t.after(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  const anchor = (
    startLine = 1,
    endLine = 2,
    quote = 'Первая 🧪\r\nSecond'
  ): ArtifactSourceAnchor => ({
    artifactId: artifact.id,
    fileSha256: artifact.sha256,
    bodyStartLine: artifact.bodyStartLine,
    startLine,
    endLine,
    quote
  })
  const create = (
    input: Partial<ArtifactReviewCreateInput> = {},
    document: Artifact = artifact
  ) =>
    storage.reviews.createThread(
      document.id,
      { requestId: randomUUID(), text: 'Comment', ...input },
      ACTOR
    )
  return {
    root,
    path,
    db,
    storage,
    artifact,
    events,
    anchor,
    create,
    advanceClock: () => {
      clock += 60_000
    }
  }
}

function command(
  kind: 'replied' | 'content_edited',
  expectedThreadVersion: number,
  text: string,
  commentId?: string
): ArtifactReviewCommentInput {
  const requestId = randomUUID()
  if (kind === 'replied') {
    return { requestId, kind, expectedThreadVersion, text }
  }
  return { requestId, kind, expectedThreadVersion, text, commentId: commentId! }
}

test('ordinary comments default to nonblocking and store server identity, time and exact source anchor', t => {
  const { storage, artifact, anchor, create, events } = setup(t)
  const event = create({ anchor: anchor() })
  assert.equal(event.createdAt, '2026-10-28T00:00:00.000Z')
  assert.deepEqual(event.actor, ACTOR)
  assert.equal(event.expectedThreadVersion, 0)
  const [thread] = storage.reviews.getThreads(artifact.id)
  assert.deepEqual(thread.anchor, anchor())
  assert.equal(thread.blocking, false)
  assert.equal(thread.effectiveResolved, false)
  assert.equal(thread.comments[0].text, 'Comment')
  assert.deepEqual(events, [
    {
      type: 'artifacts:changed',
      storeId: storage.storeId,
      storeEpoch: storage.catalog.epoch()
    }
  ])
  const last = create({ anchor: anchor(3, 3, 'Last\r') })
  assert.equal(last.payload.kind, 'created')
})

test('source anchors reject wrong identity, hash, body offset, range, normalized newline and normalized Unicode', t => {
  const { storage, artifact, anchor, create, events } = setup(
    t,
    'e\u0301\r\nSecond\n'
  )
  const valid = anchor(1, 2, 'e\u0301\r\nSecond')
  const epoch = storage.catalog.epoch()
  for (const patch of [
    { artifactId: randomUUID() },
    { fileSha256: '0'.repeat(64) },
    { bodyStartLine: artifact.bodyStartLine + 1 },
    { startLine: 0 },
    { startLine: 2, endLine: 1 },
    { endLine: 3 },
    { startLine: 1.5 },
    { quote: 'e\u0301\nSecond' },
    { quote: 'é\r\nSecond' },
    { quote: 'e\u0301\r\nSecond\n' }
  ]) {
    assert.throws(
      () => create({ anchor: { ...valid, ...patch } }),
      ArtifactInputError
    )
  }
  assert.deepEqual(storage.reviews.getThreads(artifact.id), [])
  assert.equal(storage.catalog.epoch(), epoch)
  assert.deepEqual(events, [])
  create({ anchor: valid })
})

test('empty bodies allow general comments and reject line anchors', t => {
  const { storage, artifact, anchor, create } = setup(t, '')
  const event = create()
  assert.equal(event.payload.kind === 'created' && event.payload.anchor, null)
  assert.throws(() => create({ anchor: anchor(1, 1, '') }), ArtifactInputError)
  assert.equal(storage.reviews.getThreads(artifact.id).length, 1)
})

test('a blank body line is selectable and a final newline does not create a second line', t => {
  const { anchor, create } = setup(t, '\r\n')
  create({ anchor: anchor(1, 1, '') })
  assert.throws(() => create({ anchor: anchor(2, 2, '') }), ArtifactInputError)
})

test('anchor validation reads source lines beyond the first content chunk', t => {
  const longLine = 'a'.repeat(100_000)
  const { anchor, create, storage, artifact } = setup(
    t,
    `${longLine}\r\n終わり`
  )
  create({ anchor: anchor(2, 2, '終わり') })
  assert.equal(
    storage.reviews.getThreads(artifact.id)[0].anchor?.quote.length,
    3
  )
})

test('changed and missing original files reject anchored comments without changing review state', t => {
  const { root, storage, artifact, anchor, create, events } = setup(t)
  const path = join(root, '.githuman/artifacts', `ght-${artifact.id}.md`)
  const epoch = storage.catalog.epoch()
  writeFileSync(path, 'Tampered')
  assert.throws(() => create({ anchor: anchor() }), ArtifactIntegrityError)
  unlinkSync(path)
  assert.throws(() => create({ anchor: anchor() }), ArtifactIntegrityError)
  assert.deepEqual(storage.reviews.getThreads(artifact.id), [])
  assert.equal(storage.catalog.epoch(), epoch)
  assert.deepEqual(events, [])
})

test('comment, reply, edit and hide append history while hiding preserves a blocker', t => {
  const { storage, artifact, create } = setup(t)
  const { threadId } = create({ blocking: true })
  const reply = storage.reviews.comment(
    threadId,
    command('replied', 1, 'Reply'),
    { kind: 'agent', id: 'session' }
  )
  assert.equal(reply.payload.kind, 'replied')
  const replyId =
    reply.payload.kind === 'replied' ? reply.payload.commentId : ''
  storage.reviews.comment(
    threadId,
    command('content_edited', 2, 'Edited', replyId),
    { kind: 'agent', id: 'session' }
  )
  storage.reviews.comment(
    threadId,
    {
      requestId: randomUUID(),
      kind: 'hidden',
      commentId: replyId,
      expectedThreadVersion: 3
    },
    ACTOR
  )
  const [thread] = storage.reviews.getThreads(artifact.id)
  assert.equal(thread.version, 4)
  assert.equal(thread.comments[1].text, 'Edited')
  assert.equal(thread.comments[1].hidden, true)
  assert.equal(thread.blocking, true)
  assert.equal(thread.effectiveResolved, false)
  assert.deepEqual(
    storage.reviews.history(threadId).items.map(event => event.payload.kind),
    ['created', 'replied', 'content_edited', 'hidden']
  )
})

test('retries retain thread and reply identity across clock changes and newer thread versions', t => {
  const { storage, artifact, create, anchor, advanceClock, events } = setup(t)
  const requestId = randomUUID(),
    source = anchor()
  const created = create({ requestId, anchor: source })
  const replyInput = command('replied', 1, 'Reply')
  const reply = storage.reviews.comment(created.threadId, replyInput, ACTOR)
  storage.reviews.comment(
    created.threadId,
    command('content_edited', 2, 'Edited root', created.threadId),
    ACTOR
  )
  const epoch = storage.catalog.epoch(),
    count = events.length
  advanceClock()
  assert.deepEqual(create({ requestId, anchor: source }), created)
  assert.deepEqual(
    storage.reviews.comment(created.threadId, replyInput, ACTOR),
    reply
  )
  assert.equal(storage.reviews.getThreads(artifact.id).length, 1)
  assert.equal(storage.reviews.history(created.threadId).items.length, 3)
  assert.equal(storage.catalog.epoch(), epoch)
  assert.equal(events.length, count)
  assert.throws(
    () => create({ requestId, text: 'Different', anchor: source }),
    ArtifactConflictError
  )
  assert.throws(
    () =>
      storage.reviews.comment(created.threadId, replyInput, {
        kind: 'agent',
        id: 'other'
      }),
    ArtifactConflictError
  )
})

test('accepted retries return committed events even if the source file later disappears', t => {
  const { root, artifact, create, anchor } = setup(t)
  const input = { requestId: randomUUID(), anchor: anchor() }
  const event = create(input)
  unlinkSync(join(root, '.githuman/artifacts', `ght-${artifact.id}.md`))
  assert.deepEqual(create(input), event)
})

test('ordinary commands reject protected decisions, authorization flags, caller identities and invalid versions', t => {
  const { storage, artifact, create, events } = setup(t)
  const { threadId } = create()
  const epoch = storage.catalog.epoch(),
    count = events.length
  const base = { requestId: randomUUID(), expectedThreadVersion: 1 }
  for (const extra of [
    {
      kind: 'resolved',
      scope: {
        appliesToArtifactId: artifact.id,
        includeRevisionDescendants: true
      }
    },
    {
      kind: 'reopened',
      scope: {
        appliesToArtifactId: artifact.id,
        includeRevisionDescendants: true
      }
    },
    { kind: 'blocking_changed', blocking: false },
    { kind: 'replied', text: 'Reply', authorized: true },
    { kind: 'replied', text: 'Reply', actor: ACTOR },
    { kind: 'replied', text: 'Reply', expectedThreadVersion: 0 },
    { kind: 'replied', text: 'Reply', expectedThreadVersion: 1.5 },
    { kind: 'replied', text: 'Reply', requestId: '' },
    { kind: 'replied', text: 'Reply', commentId: randomUUID() }
  ]) {
    assert.throws(
      () =>
        storage.reviews.comment(
          threadId,
          { ...base, ...extra } as ArtifactReviewCommentInput,
          ACTOR
        ),
      ArtifactInputError
    )
  }
  assert.throws(
    () => create({ actor: ACTOR } as unknown as ArtifactReviewCreateInput),
    ArtifactInputError
  )
  assert.throws(
    () =>
      create({ userRequested: true } as unknown as ArtifactReviewCreateInput),
    ArtifactInputError
  )
  assert.equal(storage.catalog.epoch(), epoch)
  assert.equal(events.length, count)
  assert.equal(storage.reviews.history(threadId).items.length, 1)
})

test('blank and oversized UTF-8 comment text is rejected for creation and updates', t => {
  const { storage, create } = setup(t)
  for (const text of ['', ' \n\t']) {
    assert.throws(() => create({ text }), ArtifactInputError)
  }
  const { threadId } = create({
    text: 'x'.repeat(MAX_ARTIFACT_REVIEW_TEXT_BYTES)
  })
  assert.throws(
    () => create({ text: '🧪'.repeat(MAX_ARTIFACT_REVIEW_TEXT_BYTES / 4 + 1) }),
    ArtifactTooLargeError
  )
  assert.throws(
    () =>
      storage.reviews.comment(threadId, command('replied', 1, ' \n'), ACTOR),
    ArtifactInputError
  )
  assert.throws(
    () =>
      storage.reviews.comment(
        threadId,
        command(
          'content_edited',
          1,
          '🧪'.repeat(MAX_ARTIFACT_REVIEW_TEXT_BYTES / 4 + 1),
          threadId
        ),
        ACTOR
      ),
    ArtifactTooLargeError
  )
  assert.equal(storage.reviews.history(threadId).items.length, 1)
})

test('history pages are complete and reject invalid ranges and unknown identities', t => {
  const { storage, create } = setup(t)
  const { threadId } = create()
  storage.reviews.comment(threadId, command('replied', 1, 'Reply'), ACTOR)
  const first = storage.reviews.history(threadId, 0, 1)
  assert.equal(first.items.length, 1)
  assert.equal(first.nextAfterSeq, first.items[0].seq)
  const second = storage.reviews.history(threadId, first.nextAfterSeq, 1)
  assert.equal(second.items.length, 1)
  assert.equal(second.nextAfterSeq, null)
  for (const [afterSeq, limit] of [
    [-1, 1],
    [0.5, 1],
    [0, 0],
    [0, 101]
  ]) {
    assert.throws(
      () => storage.reviews.history(threadId, afterSeq, limit),
      ArtifactInputError
    )
  }
  assert.throws(
    () => storage.reviews.history(randomUUID()),
    ArtifactNotFoundError
  )
  assert.throws(() => storage.reviews.getThreads('bad'), ArtifactInputError)
  assert.throws(
    () => storage.reviews.getThreads(randomUUID()),
    ArtifactNotFoundError
  )
  assert.throws(
    () =>
      storage.reviews.comment(
        randomUUID(),
        command('replied', 1, 'Reply'),
        ACTOR
      ),
    ArtifactNotFoundError
  )
})

test('revision comments inherit the original source anchor and edits; hiding does not remove inherited blockers', t => {
  const { storage, artifact, anchor, create } = setup(t)
  const { threadId } = create({ anchor: anchor(), blocking: true })
  const child = storage.create(
    {
      requestId: randomUUID(),
      body: 'Different body',
      metadata: { title: 'Revision', tags: [] },
      revisionOf: [artifact.id]
    },
    ACTOR
  )
  const [before] = storage.reviews.getThreads(child.id)
  assert.equal(before.inheritedFrom, artifact.id)
  assert.deepEqual(before.anchor, anchor())
  storage.reviews.comment(
    threadId,
    {
      requestId: randomUUID(),
      kind: 'hidden',
      commentId: threadId,
      expectedThreadVersion: 1
    },
    ACTOR
  )
  const [after] = storage.reviews.getThreads(child.id)
  assert.equal(after.blocking, true)
  assert.equal(after.effectiveResolved, false)
  assert.deepEqual(storage.reviews.getThreads(child.id, false), [])
})

test('a failed commit publishes no notification and leaves no event or projection', t => {
  const { db, storage, artifact, create, events } = setup(t)
  const epoch = storage.catalog.epoch()
  db.exec(
    `CREATE TRIGGER fail_review_commit BEFORE INSERT ON artifact_store_changes WHEN NEW.entity_kind='artifact_review' BEGIN SELECT RAISE(ABORT,'Injected failure'); END`
  )
  const requestId = randomUUID()
  assert.throws(() => create({ requestId }), /Injected failure/)
  assert.equal(storage.catalog.epoch(), epoch)
  assert.deepEqual(storage.reviews.getThreads(artifact.id), [])
  assert.deepEqual(events, [])
  db.exec('DROP TRIGGER fail_review_commit')
  create({ requestId })
  assert.equal(events.length, 1)
})

test('two live database connections reject stale thread updates and replay committed requests', t => {
  const { path, root, storage, create, advanceClock } = setup(t, 'Body', true)
  const { threadId } = create()
  const secondDb = createFileDatabase(path)
  t.after(() => secondDb.close())
  const second = new ArtifactStorageService({
    db: secondDb,
    repositoryPath: root,
    prefix: 'ght-'
  })
  const input = command('replied', 1, 'First writer')
  const event = storage.reviews.comment(threadId, input, ACTOR)
  assert.throws(
    () =>
      second.reviews.comment(
        threadId,
        command('replied', 1, 'Stale writer'),
        ACTOR
      ),
    ArtifactConflictError
  )
  advanceClock()
  assert.deepEqual(second.reviews.comment(threadId, input, ACTOR), event)
  assert.equal(second.reviews.history(threadId).items.length, 2)
})

test('review fixes: agents cannot edit or hide other actors and users cannot edit agent text', t => {
  const { storage, artifact, create } = setup(t)
  const event = create(),
    agent = { kind: 'agent' as const, id: 'session-1' }
  const edit = command('content_edited', 1, 'Forged', event.threadId)
  assert.throws(() => storage.reviews.comment(event.threadId, edit, agent), {
    statusCode: 403
  })
  assert.throws(
    () =>
      storage.reviews.comment(
        event.threadId,
        {
          requestId: randomUUID(),
          expectedThreadVersion: 1,
          kind: 'hidden',
          commentId: event.threadId
        },
        agent
      ),
    { statusCode: 403 }
  )
  const own = storage.reviews.createThread(
    artifact.id,
    { requestId: randomUUID(), text: 'Agent' },
    agent
  )
  const accepted = command('content_edited', 1, 'Agent edit', own.threadId)
  const edited = storage.reviews.comment(own.threadId, accepted, agent)
  assert.deepEqual(
    storage.reviews.comment(own.threadId, accepted, agent),
    edited
  )
  assert.throws(
    () =>
      storage.reviews.comment(
        own.threadId,
        command('content_edited', 2, 'New session', own.threadId),
        { kind: 'agent', id: 'session-2' }
      ),
    { statusCode: 403 }
  )
  assert.throws(
    () =>
      storage.reviews.comment(
        own.threadId,
        command('content_edited', 2, 'User edit', own.threadId),
        ACTOR
      ),
    { statusCode: 403 }
  )
  storage.reviews.comment(
    own.threadId,
    {
      requestId: randomUUID(),
      expectedThreadVersion: 2,
      kind: 'hidden',
      commentId: own.threadId
    },
    ACTOR
  )
})

test('review fixes: large discussions have compact lists and complete byte-budgeted pages', t => {
  const { storage, artifact, create } = setup(t)
  const { threadId } = create()
  const text = '\u0001'.repeat(64 * 1024)
  for (let version = 1; version <= 100; version++) {
    storage.reviews.comment(threadId, command('replied', version, text), ACTOR)
  }
  const page = storage.reviews.list(artifact.id, { limit: 1 })
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < 128 * 1024)
  assert.equal(page.items[0].commentCount, 101)
  assert.equal('comments' in page.items[0], false)
  assert.equal('resolutions' in page.items[0], false)
  let afterSeq = 0,
    count = 0
  for (;;) {
    const history = storage.reviews.history(threadId, afterSeq, 100)
    assertMcpSize(history)
    count += history.items.length
    if (history.nextAfterSeq === null) break
    afterSeq = history.nextAfterSeq
  }
  let afterIndex = 0,
    commentCount = 0
  const ids = new Set<string>()
  for (;;) {
    const comments = storage.reviews.comments(threadId, {
      limit: 100,
      afterIndex
    })
    assertMcpSize(comments)
    commentCount += comments.items.length
    for (const comment of comments.items) ids.add(comment.id)
    if (comments.nextAfterIndex === null) break
    afterIndex = comments.nextAfterIndex
  }
  assert.equal(commentCount, 101)
  assert.equal(ids.size, 101)
  assert.equal(count, 101)
})

test('review fixes: source quotes larger than 64 KiB are rejected without persisting events', t => {
  const body = '🧪'.repeat(16 * 1024 + 1)
  const { create, anchor, storage, artifact } = setup(t, body)
  assert.throws(
    () => create({ anchor: anchor(1, 1, body) }),
    ArtifactTooLargeError
  )
  assert.equal(storage.reviews.getThreads(artifact.id).length, 0)
})

test('review fixes: blocker IDs are bounded while the count stays exact', t => {
  const { storage, artifact, create } = setup(t)
  for (let i = 0; i < 101; i++) create({ blocking: true })
  const summary = storage.reviews.summary(artifact.id).blockerSummary
  assert.equal(summary.count, 101)
  assert.equal(summary.threadIds.length, 100)
  assert.equal(summary.truncated, true)
})

test('review fixes: comment positions survive other writes and hidden text is available only in history', t => {
  const { storage, artifact, create, anchor } = setup(t)
  const { threadId } = create({ anchor: anchor(), text: 'Hidden root' })
  storage.reviews.comment(
    threadId,
    command('replied', 1, 'Visible reply'),
    ACTOR
  )
  storage.reviews.comment(
    threadId,
    {
      requestId: randomUUID(),
      kind: 'hidden',
      commentId: threadId,
      expectedThreadVersion: 2
    },
    ACTOR
  )
  const first = storage.reviews.comments(threadId, { limit: 1 })
  assert.equal(first.items[0].text, null)
  assert.deepEqual(first.anchor, anchor())
  assert.equal(first.nextAfterIndex, 1)
  create()
  storage.updateMetadata(
    artifact.id,
    {
      requestId: randomUUID(),
      expectedVersion: 1,
      metadata: { title: 'Renamed', tags: [] }
    },
    ACTOR
  )
  const second = storage.reviews.comments(threadId, {
    limit: 1,
    afterIndex: first.nextAfterIndex
  })
  assert.equal(second.items[0].text, 'Visible reply')
  assert.equal(second.nextAfterIndex, null)
  const summary = storage.reviews
    .list(artifact.id)
    .items.find(item => item.threadId === threadId)!
  assert.equal(summary.rootComment.text, null)
  assert.equal(summary.lastComment.text, 'Visible reply')
  const old = storage.reviews.history(threadId).items[0]
  assert.equal(
    old.payload.kind === 'created' && old.payload.text,
    'Hidden root'
  )
})

test('review fixes: previews preserve UTF-8 and a quote at the exact byte limit is accepted', t => {
  const quote = '🧪'.repeat(16 * 1024)
  const { create, anchor, storage, artifact } = setup(t, quote)
  create({ anchor: anchor(1, 1, quote), text: quote })
  const item = storage.reviews.list(artifact.id).items[0]
  assert.equal(Buffer.byteLength(item.rootComment.text!), 1024)
  assert.equal(item.rootComment.truncated, true)
  assert.equal(Buffer.byteLength(item.anchor!.quote), 1024)
  assert.equal(item.anchor!.truncated, true)
  assert.ok(!item.rootComment.text!.includes('\ufffd'))
  assert.equal(storage.reviews.comments(item.threadId).items[0].text, quote)
})

test('review fixes: metadata history and catalog pages advance by delivered items under the same byte budget', t => {
  const { storage, artifact } = setup(t)
  const tags = Array.from(
    { length: 60 },
    (_, index) => '\u0001'.repeat(120) + index
  )
  const title = 'Metadata' + '\u0001'.repeat(900)
  for (let version = 1; version <= 6; version++) {
    storage.updateMetadata(
      artifact.id,
      {
        requestId: `metadata-${version}`,
        expectedVersion: version,
        metadata: { title: title + version, tags }
      },
      ACTOR
    )
  }
  let afterSeq = 0,
    count = 0
  for (;;) {
    const page = storage.history(artifact.id, afterSeq, 100)
    assert.ok(page.items.length < 7)
    count += page.items.length
    if (page.nextAfterSeq === null) break
    afterSeq = page.nextAfterSeq
  }
  assert.equal(count, 7)
  for (let i = 0; i < 5; i++) {
    storage.create(
      {
        requestId: `large-doc-${i}`,
        body: 'Body',
        metadata: { title: title + i, tags }
      },
      ACTOR
    )
  }
  let cursor: string | undefined,
    total = 0
  for (;;) {
    const page = storage.list(100, cursor)
    assert.ok(page.items.length < 6)
    total += page.items.length
    if (page.nextCursor === null) break
    cursor = page.nextCursor
  }
  assert.equal(total, 6)
})

test('review fixes: maximal escaped text and source quote fit MCP even as one oversized page item', t => {
  const text = '\u0001'.repeat(64 * 1024)
  const { storage, artifact, anchor, create } = setup(t, text)
  const event = create({ anchor: anchor(1, 1, text), text })
  assertMcpSize(event)
  assertMcpSize(storage.reviews.list(artifact.id))
  assertMcpSize(storage.reviews.history(event.threadId, 0, 100))
  assertMcpSize(storage.reviews.comments(event.threadId, { limit: 100 }))
})
