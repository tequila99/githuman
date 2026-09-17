import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { createReview } from '../../../src/server/repositories/review.repo.ts'
import {
  insertReviewFiles,
  deleteReviewFiles
} from '../../../src/server/repositories/review-file.repo.ts'
import type { Review } from '../../../src/shared/types.ts'

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
    name: null,
    branch: null,
    createdAt: now,
    updatedAt: now
  }
}

test('insertReviewFiles stores one row per file path', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('r1'))

  insertReviewFiles(db, 'r1', ['a.txt', 'b.txt'])

  const rows = db
    .prepare('SELECT file_path FROM review_files WHERE review_id = ?')
    .all('r1') as Array<{ file_path: string }>
  assert.deepEqual(rows.map(r => r.file_path).sort(), ['a.txt', 'b.txt'])
  db.close()
})

test('insertReviewFiles is a no-op for an empty list', () => {
  const db = createTestDatabase()
  createReview(db, makeReview('r1'))

  assert.doesNotThrow(() => insertReviewFiles(db, 'r1', []))

  const rows = db
    .prepare('SELECT * FROM review_files WHERE review_id = ?')
    .all('r1')
  assert.equal(rows.length, 0)
  db.close()
})

test("deleteReviewFiles removes only the given review's rows", () => {
  const db = createTestDatabase()
  createReview(db, makeReview('r1'))
  createReview(db, makeReview('r2'))
  insertReviewFiles(db, 'r1', ['a.txt'])
  insertReviewFiles(db, 'r2', ['b.txt'])

  deleteReviewFiles(db, 'r1')

  const remaining = db
    .prepare('SELECT review_id FROM review_files')
    .all() as Array<{ review_id: string }>
  assert.deepEqual(
    remaining.map(r => r.review_id),
    ['r2']
  )
  db.close()
})
