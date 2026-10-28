import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { applyArtifactMigrations } from '../../../src/server/db/artifact-migrations.ts'
import { applyArtifactGraphMigrations } from '../../../src/server/db/artifact-graph-migrations.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { applyMigrations } from '../../../src/server/db/migrations.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'
import { ArtifactReviewRepository } from '../../../src/server/repositories/artifact-review.repo.ts'
import {
  ArtifactConflictError,
  ArtifactInputError,
  ArtifactNotFoundError
} from '../../../src/server/errors/artifacts.ts'
import type {
  ArtifactReviewEventPayload,
  ArtifactReviewEvent
} from '../../../src/shared/artifacts/types.ts'

// All writes share one server-assigned identity in this repository fixture.
const ACTOR = { kind: 'user' as const, id: 'local' }

function scope(id: string) {
  return { appliesToArtifactId: id, includeRevisionDescendants: true as const }
}

function setup(t: TestContext, legacy = false) {
  const root = mkdtempSync(join(tmpdir(), 'ght-review-'))
  const db = legacy ? new DatabaseSync(':memory:') : createTestDatabase()
  if (legacy) {
    applyArtifactMigrations(db)
    applyArtifactGraphMigrations(db)
  }
  t.after(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  const storage = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  const repo = new ArtifactReviewRepository(db, storage.catalog)
  const create = (parent?: string) =>
    storage.create(
      {
        requestId: randomUUID(),
        body: 'Original\r\n🧪\n',
        metadata: { title: 'Document', tags: [] },
        revisionOf: parent ? [parent] : []
      },
      ACTOR
    )
  const origin = create()
  const threadId = randomUUID()
  const input = (
    payload: ArtifactReviewEventPayload,
    version: number,
    id = threadId
  ): Omit<ArtifactReviewEvent, 'storeId' | 'seq'> => ({
    threadId: id,
    originArtifactId: origin.id,
    expectedThreadVersion: version,
    actor: ACTOR,
    createdAt: '2026-10-28T00:00:00.000Z',
    payload
  })
  const append = (
    payload: ArtifactReviewEventPayload,
    version: number,
    id = threadId
  ) => repo.append(randomUUID(), input(payload, version, id))
  const start = (blocking = false) =>
    append(
      {
        kind: 'created',
        text: 'Original comment',
        blocking,
        anchor: {
          artifactId: origin.id,
          fileSha256: origin.sha256,
          bodyStartLine: origin.bodyStartLine,
          startLine: 1,
          endLine: 2,
          quote: 'Original\r\n🧪'
        }
      },
      0
    )

  return {
    root,
    db,
    storage,
    repo,
    create,
    origin,
    threadId,
    input,
    append,
    start
  }
}

test('events preserve edits and hiding while projection retains the blocker and original anchor', t => {
  const { repo, origin, threadId, append, start } = setup(t)
  start(true)
  const reply = randomUUID()
  append({ kind: 'replied', commentId: reply, text: 'Ответ' }, 1)
  append({ kind: 'content_edited', commentId: threadId, text: 'Edited' }, 2)
  append({ kind: 'hidden', commentId: threadId }, 3)
  const [thread] = repo.getThreads(origin.id)
  assert.equal(thread.version, 4)
  assert.equal(thread.blocking, true)
  assert.equal(thread.effectiveResolved, false)
  assert.equal(thread.inheritedFrom, null)
  assert.equal(thread.anchor?.quote, 'Original\r\n🧪')
  assert.equal(thread.comments[0].hidden, true)
  assert.equal(thread.comments[0].text, 'Edited')
  assert.equal(thread.comments[1].text, 'Ответ')
  const firstPage = repo.history(threadId, 0, 2)
  assert.deepEqual(
    firstPage.map(event => event.payload.kind),
    ['created', 'replied']
  )
  assert.equal(
    firstPage[0].payload.kind === 'created' && firstPage[0].payload.text,
    'Original comment'
  )
  assert.deepEqual(
    repo
      .history(threadId, firstPage[1].seq, 2)
      .map(event => event.payload.kind),
    ['content_edited', 'hidden']
  )
  assert.throws(
    () =>
      append(
        { kind: 'content_edited', commentId: threadId, text: 'Restore' },
        4
      ),
    ArtifactConflictError
  )
  assert.equal(repo.history(threadId, 0, 100).length, 4)
})

test('revision inheritance is unique and independent of parent and reference relationships', t => {
  const { repo, storage, create, origin, threadId, start } = setup(t)
  start()
  const b = create(origin.id),
    c = create(b.id)
  const inherited = repo.getThreads(c.id)
  assert.equal(inherited.length, 1)
  assert.equal(inherited[0].threadId, threadId)
  assert.equal(inherited[0].inheritedFrom, origin.id)
  assert.equal(inherited[0].anchor?.artifactId, origin.id)
  assert.equal(inherited[0].blocking, false)
  assert.deepEqual(repo.getThreads(c.id, false), [])
  const unrelated = storage.create(
    {
      requestId: randomUUID(),
      body: 'Other',
      metadata: {
        title: 'Other',
        tags: [],
        relations: [
          { kind: 'parent', targetId: origin.id },
          { kind: 'references', targetId: b.id }
        ]
      }
    },
    ACTOR
  )
  assert.deepEqual(repo.getThreads(unrelated.id), [])
  const old = storage.catalog.get(origin.id)!
  storage.catalog.transaction(() =>
    storage.catalog.appendMetadata(
      { ...old, status: 'deleted', metadataVersion: 2 },
      randomUUID(),
      ACTOR,
      'metadata_updated'
    )
  )
  assert.equal(repo.getThreads(c.id)[0].threadId, threadId)
})

test('resolve and reopen affect one revision branch including future descendants, without changing siblings', t => {
  const { repo, create, origin, threadId, append, start } = setup(t)
  start(true)
  const b = create(origin.id),
    c = create(origin.id),
    descendant = create(b.id)
  append({ kind: 'resolved', scope: scope(b.id) }, 1)
  assert.deepEqual(repo.getThreads(b.id), [])
  assert.deepEqual(repo.getThreads(descendant.id), [])
  assert.equal(repo.getThreads(c.id)[0].effectiveResolved, false)
  assert.equal(repo.getThreads(origin.id)[0].effectiveResolved, false)
  const future = create(b.id)
  assert.deepEqual(repo.getThreads(future.id), [])
  append({ kind: 'reopened', scope: scope(descendant.id) }, 2)
  assert.equal(repo.getThreads(descendant.id)[0].blocking, true)
  assert.deepEqual(repo.getThreads(b.id), [])
  append({ kind: 'resolved', scope: scope(origin.id) }, 3)
  assert.deepEqual(repo.getThreads(descendant.id), [])
  assert.equal(repo.getThreads(origin.id)[0].effectiveResolved, true)
  assert.equal(repo.get(threadId)?.resolutions.length, 3)
})

test('stale versions, invalid comment references and origin changes leave history and epochs unchanged', t => {
  const { repo, storage, create, origin, threadId, input, append, start } =
    setup(t)
  const other = create()
  start()
  append(
    { kind: 'blocking_changed', blocking: true, scope: scope(origin.id) },
    1
  )
  const epoch = storage.catalog.epoch()
  assert.throws(
    () => append({ kind: 'resolved', scope: scope(origin.id) }, 1),
    ArtifactConflictError
  )
  assert.throws(
    () => append({ kind: 'hidden', commentId: randomUUID() }, 2),
    ArtifactInputError
  )
  assert.throws(
    () =>
      repo.append(randomUUID(), {
        ...input({ kind: 'hidden', commentId: threadId }, 2),
        originArtifactId: other.id
      }),
    ArtifactInputError
  )
  assert.throws(
    () => append({ kind: 'resolved', scope: scope(randomUUID()) }, 2),
    ArtifactNotFoundError
  )
  assert.throws(
    () =>
      append(
        { kind: 'created', text: 'Again', blocking: false, anchor: null },
        2
      ),
    ArtifactConflictError
  )
  assert.equal(storage.catalog.epoch(), epoch)
  assert.equal(repo.get(threadId)?.version, 2)
  assert.equal(repo.history(threadId, 0, 100).length, 2)
})

test('request replay is idempotent, identity-bound and stable across reopen', t => {
  const { root, db, repo, storage, threadId, input } = setup(t)
  const requestId = randomUUID()
  const data = input(
    { kind: 'created', text: 'Once', blocking: false, anchor: null },
    0
  )
  const event = repo.append(requestId, data)
  const epoch = storage.catalog.epoch()
  assert.deepEqual(repo.append(requestId, data), event)
  assert.throws(
    () =>
      repo.append(requestId, {
        ...data,
        actor: { kind: 'agent', id: 'other' }
      }),
    ArtifactConflictError
  )
  const reopened = new ArtifactReviewRepository(
    db,
    new ArtifactStorageService({ db, repositoryPath: root, prefix: 'ght-' })
      .catalog
  )
  assert.deepEqual(reopened.append(requestId, data), event)
  assert.equal(reopened.history(threadId, 0, 100).length, 1)
  assert.equal(storage.catalog.epoch(), epoch)
})

test('failure after projection update rolls back event, projection and store epoch', t => {
  const { db, repo, storage, threadId, append, start } = setup(t)
  start()
  const before = repo.get(threadId),
    epoch = storage.catalog.epoch()
  db.exec(
    `CREATE TRIGGER fail_review_journal BEFORE INSERT ON artifact_store_changes WHEN NEW.entity_kind='artifact_review' BEGIN SELECT RAISE(ABORT,'Injected journal failure'); END`
  )
  assert.throws(
    () => append({ kind: 'hidden', commentId: threadId }, 1),
    /Injected journal failure/
  )
  assert.deepEqual(repo.get(threadId), before)
  assert.equal(repo.history(threadId, 0, 100).length, 1)
  assert.equal(storage.catalog.epoch(), epoch)
  db.exec('DROP TRIGGER fail_review_journal')
  append({ kind: 'hidden', commentId: threadId }, 1)
  assert.equal(repo.get(threadId)?.version, 2)
})

test('repository savepoints preserve outer transaction rollback', t => {
  const { repo, storage, threadId, start } = setup(t)
  const epoch = storage.catalog.epoch()
  assert.throws(
    () =>
      storage.catalog.transaction(() => {
        start()
        throw new Error('Outer rollback')
      }),
    /Outer rollback/
  )
  assert.equal(repo.get(threadId), undefined)
  assert.deepEqual(repo.history(threadId, 0, 100), [])
  assert.equal(storage.catalog.epoch(), epoch)
})

test('migration reruns preserve existing artifacts and history; the current projection can be rebuilt', t => {
  const { db, repo, storage, origin, threadId, append, start } = setup(t, true)
  const originalHistory = storage.history(origin.id)
  const originalEpoch = storage.catalog.epoch()
  applyMigrations(db)
  assert.deepEqual(storage.history(origin.id), originalHistory)
  assert.equal(storage.catalog.epoch(), originalEpoch)
  start(true)
  append({ kind: 'content_edited', commentId: threadId, text: 'New text' }, 1)
  append({ kind: 'resolved', scope: scope(origin.id) }, 2)
  append({ kind: 'reopened', scope: scope(origin.id) }, 3)
  const before = repo.getThreads(origin.id),
    history = repo.history(threadId, 0, 100),
    epoch = storage.catalog.epoch()
  applyMigrations(db)
  applyMigrations(db)
  assert.deepEqual(repo.getThreads(origin.id), before)
  assert.deepEqual(storage.get(origin.id), origin)
  db.prepare('DELETE FROM artifact_thread_current WHERE store_id=?').run(
    storage.storeId
  )
  repo.rebuild()
  assert.deepEqual(repo.getThreads(origin.id), before)
  assert.deepEqual(repo.history(threadId, 0, 100), history)
  assert.equal(storage.catalog.epoch(), epoch)
})

test('review events reject UPDATE, DELETE and REPLACE bypasses', t => {
  const { db, repo, threadId, start } = setup(t)
  start()
  const event = repo.history(threadId, 0, 1)[0]
  for (const sql of [
    'UPDATE artifact_review_events SET version=9',
    'DELETE FROM artifact_review_events',
    'INSERT OR REPLACE INTO artifact_review_events SELECT * FROM artifact_review_events',
    "INSERT OR REPLACE INTO artifact_review_events(rowid,store_id,thread_id,origin_artifact_id,version,request_id,data_json) SELECT rowid,store_id,thread_id,origin_artifact_id,version+1,request_id || 'new',data_json FROM artifact_review_events"
  ]) {
    assert.throws(() => db.exec(sql), /immutable/)
  }
  assert.deepEqual(repo.history(threadId, 0, 100), [event])
})

test('separate stores cannot read or mutate each other’s review threads', t => {
  const { root, db, repo, origin, threadId, input, start } = setup(t)
  start()
  const other = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'other-'
  })
  const otherRepo = new ArtifactReviewRepository(db, other.catalog)
  assert.equal(otherRepo.get(threadId), undefined)
  assert.deepEqual(otherRepo.history(threadId, 0, 100), [])
  assert.throws(() => otherRepo.getThreads(origin.id), ArtifactNotFoundError)
  assert.throws(
    () =>
      otherRepo.append(
        randomUUID(),
        input({ kind: 'hidden', commentId: threadId }, 1)
      ),
    ArtifactNotFoundError
  )
  assert.equal(repo.get(threadId)?.version, 1)
})

test('invalid event shapes, foreign anchors and duplicate replies cannot create partial history', t => {
  const { repo, storage, origin, threadId, append, input, start } = setup(t)
  const created = input(
    { kind: 'created', text: 'Comment', blocking: false, anchor: null },
    0
  )
  const epoch = storage.catalog.epoch()
  assert.throws(
    () => repo.append(randomUUID(), { ...created, expectedThreadVersion: -1 }),
    ArtifactInputError
  )
  assert.throws(
    () =>
      repo.append(randomUUID(), {
        ...created,
        payload: { kind: 'created', text: '', blocking: false, anchor: null }
      }),
    ArtifactInputError
  )
  assert.throws(
    () =>
      append(
        {
          kind: 'created',
          text: 'Comment',
          blocking: false,
          anchor: {
            artifactId: randomUUID(),
            fileSha256: origin.sha256,
            bodyStartLine: origin.bodyStartLine,
            startLine: 1,
            endLine: 1,
            quote: 'Original'
          }
        },
        0
      ),
    ArtifactInputError
  )
  assert.equal(repo.get(threadId), undefined)
  assert.deepEqual(repo.history(threadId, 0, 100), [])
  assert.equal(storage.catalog.epoch(), epoch)
  start()
  const reply = randomUUID()
  append({ kind: 'replied', commentId: reply, text: 'Reply' }, 1)
  assert.throws(
    () => append({ kind: 'replied', commentId: reply, text: 'Duplicate' }, 2),
    ArtifactConflictError
  )
  assert.equal(repo.get(threadId)?.version, 2)
  assert.equal(repo.history(threadId, 0, 100).length, 2)
})
