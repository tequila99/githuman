import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { createReview } from '../../../src/server/repositories/review.repo.ts'
import {
  createComment,
  getComments,
  editComment,
  removeComment,
  resolveComment,
  unresolveComment,
  ValidationError
} from '../../../src/server/services/comment.service.ts'
import type { Review } from '../../../src/shared/types.ts'
import { createEventBus } from '../../../src/server/event-bus.ts'

function makeReview(id: string): Review {
  const now = new Date().toISOString()
  return {
    id,
    repositoryPath: '/repo',
    baseRef: null,
    sourceType: 'staged',
    sourceRef: null,
    snapshotData: '[]',
    status: 'in_progress',
    createdAt: now,
    updatedAt: now
  }
}

test('createComment persists a valid line-level comment', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('review-1'))

  const comment = createComment(db, 'review-1', {
    filePath: 'a.txt',
    lineNumber: 3,
    lineType: 'added',
    content: 'hi'
  })

  assert.equal(comment.filePath, 'a.txt')
  assert.equal(getComments(db, 'review-1').length, 1)
  db.close()
})

test('createComment allows a file-level comment without lineNumber', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('review-1'))

  const comment = createComment(db, 'review-1', {
    filePath: 'a.txt',
    content: 'file-level'
  })

  assert.equal(comment.lineNumber, null)
  assert.equal(comment.lineType, null)
  db.close()
})

test('createComment rejects empty content', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('review-1'))

  assert.throws(
    () => createComment(db, 'review-1', { filePath: 'a.txt', content: '' }),
    ValidationError
  )
  db.close()
})

test('editComment updates content', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('review-1'))
  const comment = createComment(db, 'review-1', {
    filePath: 'a.txt',
    content: 'hi'
  })

  const updated = editComment(db, comment.id, 'edited')

  assert.equal(updated?.content, 'edited')
  db.close()
})

test('removeComment deletes the comment', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('review-1'))
  const comment = createComment(db, 'review-1', {
    filePath: 'a.txt',
    content: 'hi'
  })

  removeComment(db, comment.id)

  assert.equal(getComments(db, 'review-1').length, 0)
  db.close()
})

test('createComment publishes a comment:created event when given an event bus', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('review-1'))
  const eventBus = createEventBus()
  const received: unknown[] = []
  eventBus.subscribe(event => received.push(event))

  createComment(db, 'review-1', { filePath: 'a.txt', content: 'hi' }, eventBus)

  assert.deepEqual(received, [
    { type: 'comment:created', reviewId: 'review-1' }
  ])
  db.close()
})

test('editComment publishes a comment:updated event when given an event bus', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('review-1'))
  const comment = createComment(db, 'review-1', {
    filePath: 'a.txt',
    content: 'hi'
  })
  const eventBus = createEventBus()
  const received: unknown[] = []
  eventBus.subscribe(event => received.push(event))

  editComment(db, comment.id, 'edited', eventBus)

  assert.deepEqual(received, [
    { type: 'comment:updated', reviewId: 'review-1' }
  ])
  db.close()
})

test('createComment stores an optional suggestion', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('review-1'))

  const comment = createComment(db, 'review-1', {
    filePath: 'a.txt',
    content: 'hi',
    suggestion: 'const x = 1;'
  })

  assert.equal(comment.suggestion, 'const x = 1;')
  db.close()
})

test('resolveComment marks a comment resolved and publishes a comment:updated event', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('review-1'))
  const comment = createComment(db, 'review-1', {
    filePath: 'a.txt',
    content: 'hi'
  })
  const eventBus = createEventBus()
  const received: unknown[] = []
  eventBus.subscribe(event => received.push(event))

  const resolved = resolveComment(db, comment.id, eventBus)

  assert.equal(resolved?.resolved, true)
  assert.deepEqual(received, [
    { type: 'comment:updated', reviewId: 'review-1' }
  ])
  db.close()
})

test('unresolveComment marks a comment unresolved', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('review-1'))
  const comment = createComment(db, 'review-1', {
    filePath: 'a.txt',
    content: 'hi'
  })
  resolveComment(db, comment.id)

  const unresolved = unresolveComment(db, comment.id)

  assert.equal(unresolved?.resolved, false)
  db.close()
})

test('removeComment publishes a comment:deleted event when given an event bus', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('review-1'))
  const comment = createComment(db, 'review-1', {
    filePath: 'a.txt',
    content: 'hi'
  })
  const eventBus = createEventBus()
  const received: unknown[] = []
  eventBus.subscribe(event => received.push(event))

  removeComment(db, comment.id, eventBus)

  assert.deepEqual(received, [
    { type: 'comment:deleted', reviewId: 'review-1' }
  ])
  db.close()
})
