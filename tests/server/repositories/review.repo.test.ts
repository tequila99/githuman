import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import {
  createReview,
  findReviewById,
  listReviews,
  updateReviewStatus,
  deleteReview
} from '../../../src/server/repositories/review.repo.ts'
import type { Review } from '../../../src/shared/types.ts'

function makeReview(overrides: Partial<Review> = {}): Review {
  const now = new Date().toISOString()
  return {
    id: overrides.id ?? crypto.randomUUID(),
    repositoryPath: '/repo',
    baseRef: null,
    sourceType: 'staged',
    sourceRef: null,
    snapshotData: '[]',
    status: 'in_progress',
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

test('create + findById round-trips a review', () => {
  const db = createTestDatabase()
  const review = makeReview()

  createReview(db, review)
  const found = findReviewById(db, review.id)

  assert.deepEqual(found, review)
  db.close()
})

test('findById returns null for an unknown id', () => {
  const db = createTestDatabase()

  const found = findReviewById(db, 'does-not-exist')

  assert.equal(found, null)
  db.close()
})

test('list returns reviews ordered by createdAt descending', () => {
  const db = createTestDatabase()

  const older = makeReview({
    id: 'older',
    createdAt: '2026-01-01T00:00:00.000Z'
  })
  const newer = makeReview({
    id: 'newer',
    createdAt: '2026-06-01T00:00:00.000Z'
  })
  createReview(db, older)
  createReview(db, newer)

  const list = listReviews(db)

  assert.deepEqual(
    list.map(r => r.id),
    ['newer', 'older']
  )
  db.close()
})

test('updateStatus updates status and updatedAt, and returns the updated review', () => {
  const db = createTestDatabase()
  const review = makeReview({ status: 'in_progress' })
  createReview(db, review)

  const updated = updateReviewStatus(db, review.id, 'approved')

  assert.equal(updated?.status, 'approved')
  assert.ok(updated !== null && updated.updatedAt >= review.updatedAt)

  const refetched = findReviewById(db, review.id)
  assert.equal(refetched?.status, 'approved')
  db.close()
})

test('updateStatus returns null when the review does not exist', () => {
  const db = createTestDatabase()

  const result = updateReviewStatus(db, 'missing', 'approved')

  assert.equal(result, null)
  db.close()
})

test('deleteReview removes the review', () => {
  const db = createTestDatabase()
  const review = makeReview()
  createReview(db, review)

  deleteReview(db, review.id)

  assert.equal(findReviewById(db, review.id), null)
  db.close()
})
