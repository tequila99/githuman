import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { createReview } from '../../../src/server/repositories/review.repo.ts'
import {
  createComment,
  listCommentsByReview,
  updateComment,
  deleteComment,
  setCommentResolved
} from '../../../src/server/repositories/comment.repo.ts'
import type { Comment, Review } from '../../../src/shared/types.ts'

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

function makeComment(overrides: Partial<Comment> = {}): Comment {
  const now = new Date().toISOString()
  return {
    id: overrides.id ?? crypto.randomUUID(),
    reviewId: 'review-1',
    filePath: 'a.txt',
    lineNumber: 10,
    lineType: 'added',
    content: 'hello',
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

test('createComment stores a comment and returns it', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('review-1'))

  const comment = createComment(db, makeComment())

  const [found] = listCommentsByReview(db, 'review-1')
  assert.equal(found.id, comment.id)
  assert.equal(found.content, 'hello')
  db.close()
})

test('createComment supports file-level comments with a null lineNumber/lineType', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('review-1'))

  createComment(db, makeComment({ lineNumber: null, lineType: null }))

  const [found] = listCommentsByReview(db, 'review-1')
  assert.equal(found.lineNumber, null)
  assert.equal(found.lineType, null)
  db.close()
})

test('listCommentsByReview only returns comments for the given review', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('review-1'))
  createReview(db, makeReview('review-2'))
  createComment(db, makeComment({ reviewId: 'review-1' }))
  createComment(db, makeComment({ reviewId: 'review-2' }))

  const list = listCommentsByReview(db, 'review-1')

  assert.equal(list.length, 1)
  assert.equal(list[0].reviewId, 'review-1')
  db.close()
})

test('updateComment updates content and updatedAt', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('review-1'))
  const comment = createComment(db, makeComment())

  const updated = updateComment(db, comment.id, 'edited')

  assert.equal(updated?.content, 'edited')
  assert.ok(updated.updatedAt >= comment.updatedAt)
  db.close()
})

test('updateComment returns null for an unknown id', () => {
  const db = createTestDatabase()
  assert.equal(updateComment(db, 'does-not-exist', 'x'), null)
  db.close()
})

test('deleteComment removes the comment', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('review-1'))
  const comment = createComment(db, makeComment())

  deleteComment(db, comment.id)

  assert.equal(listCommentsByReview(db, 'review-1').length, 0)
  db.close()
})

test('createComment defaults resolved to false and stores an optional suggestion', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('review-1'))

  createComment(db, makeComment({ suggestion: 'const x = 1;' }))

  const [found] = listCommentsByReview(db, 'review-1')
  assert.equal(found.resolved, false)
  assert.equal(found.suggestion, 'const x = 1;')
  db.close()
})

test('setCommentResolved marks a comment resolved and back to unresolved', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('review-1'))
  const comment = createComment(db, makeComment())

  const resolved = setCommentResolved(db, comment.id, true)
  assert.equal(resolved?.resolved, true)

  const unresolved = setCommentResolved(db, comment.id, false)
  assert.equal(unresolved?.resolved, false)
  db.close()
})

test('setCommentResolved returns null for an unknown id', () => {
  const db = createTestDatabase()
  assert.equal(setCommentResolved(db, 'does-not-exist', true), null)
  db.close()
})
