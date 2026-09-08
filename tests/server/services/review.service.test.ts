import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTempGitRepo } from '../helpers/git-fixture.ts'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import {
  createReview,
  setReviewStatus,
  removeReview,
  getReview,
  ValidationError
} from '../../../src/server/services/review.service.ts'
import { createEventBus } from '../../../src/server/event-bus.ts'
import {
  createComment,
  getComments
} from '../../../src/server/services/comment.service.ts'

test('createReview (staged) snapshots the current staged diff and stores it as in_progress', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const db = createTestDatabase()
  t.after(() => db.close())

  writeFileSync(join(fixture.dir, 'a.txt'), 'v1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')
  writeFileSync(join(fixture.dir, 'a.txt'), 'v2\n')
  await fixture.git.add('a.txt')

  const review = await createReview(db, fixture.dir, { sourceType: 'staged' })

  assert.equal(review.status, 'in_progress')
  assert.equal(review.sourceType, 'staged')
  const snapshot = JSON.parse(review.snapshotData)
  assert.equal(snapshot.length, 1)
  assert.equal(snapshot[0].newPath, 'a.txt')
})

test('createReview (unstaged) snapshots unstaged tracked edits and untracked files, requires no baseRef/sourceRef', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const db = createTestDatabase()
  t.after(() => db.close())

  writeFileSync(join(fixture.dir, 'a.txt'), 'v1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')
  writeFileSync(join(fixture.dir, 'a.txt'), 'v2\n')

  const review = await createReview(db, fixture.dir, { sourceType: 'unstaged' })

  assert.equal(review.status, 'in_progress')
  assert.equal(review.sourceType, 'unstaged')
  assert.equal(review.baseRef, null)
  assert.equal(review.sourceRef, null)
  const snapshot = JSON.parse(review.snapshotData)
  assert.equal(snapshot.length, 1)
  assert.equal(snapshot[0].newPath, 'a.txt')
  assert.equal(snapshot[0].status, 'modified')
})

test('createReview defaults to sourceType "staged" when omitted', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const db = createTestDatabase()
  t.after(() => db.close())

  const review = await createReview(db, fixture.dir, {})

  assert.equal(review.sourceType, 'staged')
})

test('createReview (branch) requires baseRef', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const db = createTestDatabase()
  t.after(() => db.close())

  await assert.rejects(
    () => createReview(db, fixture.dir, { sourceType: 'branch' }),
    ValidationError
  )
})

test('createReview (commits) requires both baseRef and sourceRef', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const db = createTestDatabase()
  t.after(() => db.close())

  await assert.rejects(
    () =>
      createReview(db, fixture.dir, {
        sourceType: 'commits',
        baseRef: 'abc123'
      }),
    ValidationError
  )
})

test('createReview rejects an unknown sourceType before touching git or the database', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const db = createTestDatabase()
  t.after(() => db.close())

  await assert.rejects(
    // @ts-expect-error deliberately invalid input for the validation test
    () => createReview(db, fixture.dir, { sourceType: 'bogus' }),
    ValidationError
  )
})

test('createReview publishes a review:created event when given an event bus', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const db = createTestDatabase()
  t.after(() => db.close())
  const eventBus = createEventBus()
  const received: unknown[] = []
  eventBus.subscribe(event => received.push(event))

  const review = await createReview(
    db,
    fixture.dir,
    { sourceType: 'staged' },
    eventBus
  )

  assert.deepEqual(received, [{ type: 'review:created', reviewId: review.id }])
})

test('setReviewStatus publishes a review:updated event when given an event bus', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const db = createTestDatabase()
  t.after(() => db.close())
  const review = await createReview(db, fixture.dir, { sourceType: 'staged' })
  const eventBus = createEventBus()
  const received: unknown[] = []
  eventBus.subscribe(event => received.push(event))

  setReviewStatus(db, review.id, 'approved', eventBus)

  assert.deepEqual(received, [{ type: 'review:updated', reviewId: review.id }])
})

test('removeReview deletes the review and its comments, and publishes a review:deleted event', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const db = createTestDatabase()
  t.after(() => db.close())
  const review = await createReview(db, fixture.dir, { sourceType: 'staged' })
  createComment(db, review.id, { filePath: 'a.txt', content: 'hi' })
  const eventBus = createEventBus()
  const received: unknown[] = []
  eventBus.subscribe(event => received.push(event))

  removeReview(db, review.id, eventBus)

  assert.equal(getReview(db, review.id), null)
  assert.equal(getComments(db, review.id).length, 0)
  assert.deepEqual(received, [{ type: 'review:deleted', reviewId: review.id }])
})
