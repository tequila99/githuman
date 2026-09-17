import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import {
  createReview,
  findReviewById,
  listReviews,
  updateReviewStatus,
  deleteReview,
  UniqueNameError
} from '../../../src/server/repositories/review.repo.ts'
import { insertReviewFiles } from '../../../src/server/repositories/review-file.repo.ts'
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
    name: null,
    branch: null,
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

test('createReview throws UniqueNameError for a duplicate (name, branch) pair', () => {
  const db = createTestDatabase()
  createReview(db, makeReview({ id: 'r1', name: 'My review', branch: 'main' }))

  assert.throws(
    () =>
      createReview(
        db,
        makeReview({ id: 'r2', name: 'My review', branch: 'main' })
      ),
    UniqueNameError
  )
  db.close()
})

test('createReview allows the same name on a different branch', () => {
  const db = createTestDatabase()
  createReview(db, makeReview({ id: 'r1', name: 'My review', branch: 'main' }))

  assert.doesNotThrow(() =>
    createReview(
      db,
      makeReview({ id: 'r2', name: 'My review', branch: 'develop' })
    )
  )
  db.close()
})

test('listReviews filters by branch', () => {
  const db = createTestDatabase()
  createReview(db, makeReview({ id: 'r1', branch: 'main' }))
  createReview(db, makeReview({ id: 'r2', branch: 'develop' }))

  const list = listReviews(db, { branch: 'main' })

  assert.deepEqual(
    list.map(r => r.id),
    ['r1']
  )
  db.close()
})

test('listReviews filters by search, case-insensitively (including Cyrillic)', () => {
  const db = createTestDatabase()
  createReview(db, makeReview({ id: 'r1', name: 'Правки ревью' }))
  createReview(db, makeReview({ id: 'r2', name: 'Something else' }))

  const list = listReviews(db, { search: 'ПРАВКИ' })

  assert.deepEqual(
    list.map(r => r.id),
    ['r1']
  )
  db.close()
})

test('listReviews filters by createdFrom/createdTo', () => {
  const db = createTestDatabase()
  createReview(
    db,
    makeReview({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' })
  )
  createReview(
    db,
    makeReview({ id: 'mid', createdAt: '2026-06-01T00:00:00.000Z' })
  )
  createReview(
    db,
    makeReview({ id: 'new', createdAt: '2026-12-01T00:00:00.000Z' })
  )

  const list = listReviews(db, {
    createdFrom: '2026-03-01T00:00:00.000Z',
    createdTo: '2026-09-01T00:00:00.000Z'
  })

  assert.deepEqual(
    list.map(r => r.id),
    ['mid']
  )
  db.close()
})

test('listReviews filters by filePaths via the review_files index, without duplicates', () => {
  const db = createTestDatabase()
  createReview(db, makeReview({ id: 'r1' }))
  createReview(db, makeReview({ id: 'r2' }))
  createReview(db, makeReview({ id: 'r3' }))
  insertReviewFiles(db, 'r1', ['a.txt', 'b.txt'])
  insertReviewFiles(db, 'r2', ['b.txt'])
  insertReviewFiles(db, 'r3', ['c.txt'])

  const list = listReviews(db, { filePaths: ['a.txt', 'b.txt'] })

  assert.deepEqual(list.map(r => r.id).sort(), ['r1', 'r2'])
  db.close()
})
