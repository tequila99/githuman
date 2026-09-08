import type { DatabaseSync } from 'node:sqlite'
import type { Review, ReviewStatus } from '../../shared/types.ts'

interface ReviewRow {
  id: string
  repository_path: string
  base_ref: string | null
  source_type: Review['sourceType']
  source_ref: string | null
  snapshot_data: string
  status: ReviewStatus
  created_at: string
  updated_at: string
}

function rowToReview(row: ReviewRow): Review {
  return {
    id: row.id,
    repositoryPath: row.repository_path,
    baseRef: row.base_ref,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    snapshotData: row.snapshot_data,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function createReview(db: DatabaseSync, review: Review): Review {
  db.prepare(
    `INSERT INTO reviews (id, repository_path, base_ref, source_type, source_ref, snapshot_data, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    review.id,
    review.repositoryPath,
    review.baseRef,
    review.sourceType,
    review.sourceRef,
    review.snapshotData,
    review.status,
    review.createdAt,
    review.updatedAt
  )

  return review
}

export function findReviewById(db: DatabaseSync, id: string): Review | null {
  const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) as
    | ReviewRow
    | undefined
  return row ? rowToReview(row) : null
}

export function listReviews(db: DatabaseSync): Review[] {
  const rows = db
    .prepare('SELECT * FROM reviews ORDER BY created_at DESC')
    .all() as unknown as ReviewRow[]
  return rows.map(rowToReview)
}

export function deleteReview(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(id)
}

export function updateReviewStatus(
  db: DatabaseSync,
  id: string,
  status: ReviewStatus
): Review | null {
  const updatedAt = new Date().toISOString()
  const result = db
    .prepare('UPDATE reviews SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, updatedAt, id)

  if (result.changes === 0) {
    return null
  }

  return findReviewById(db, id)
}
