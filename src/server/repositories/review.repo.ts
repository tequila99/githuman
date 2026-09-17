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
  name: string | null
  branch: string | null
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
    name: row.name,
    branch: row.branch,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** Thrown by `createReview` when `(name, branch)` collides with an existing review — see ADR 0017. */
export class UniqueNameError extends Error {}

export function createReview(db: DatabaseSync, review: Review): Review {
  try {
    db.prepare(
      `INSERT INTO reviews (id, repository_path, base_ref, source_type, source_ref, snapshot_data, status, name, branch, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      review.id,
      review.repositoryPath,
      review.baseRef,
      review.sourceType,
      review.sourceRef,
      review.snapshotData,
      review.status,
      review.name,
      review.branch,
      review.createdAt,
      review.updatedAt
    )
  } catch (error) {
    if (
      error instanceof Error &&
      /UNIQUE constraint failed: reviews\.name, reviews\.branch/.test(
        error.message
      )
    ) {
      throw new UniqueNameError(
        `A review named "${review.name}" already exists on branch "${review.branch}"`
      )
    }
    throw error
  }

  return review
}

export function findReviewById(db: DatabaseSync, id: string): Review | null {
  const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) as
    | ReviewRow
    | undefined
  return row ? rowToReview(row) : null
}

export interface ListReviewsFilters {
  branch?: string
  search?: string
  createdFrom?: string
  createdTo?: string
  filePaths?: string[]
}

export function listReviews(
  db: DatabaseSync,
  filters: ListReviewsFilters = {}
): Review[] {
  const { branch, search, createdFrom, createdTo, filePaths } = filters
  const conditions: string[] = []
  const params: (string | number)[] = []
  const joins: string[] = []

  if (branch !== undefined) {
    conditions.push('reviews.branch = ?')
    params.push(branch)
  }
  if (createdFrom) {
    conditions.push('reviews.created_at >= ?')
    params.push(createdFrom)
  }
  if (createdTo) {
    conditions.push('reviews.created_at <= ?')
    params.push(createdTo)
  }
  if (filePaths && filePaths.length > 0) {
    joins.push('JOIN review_files ON review_files.review_id = reviews.id')
    conditions.push(
      `review_files.file_path IN (${filePaths.map(() => '?').join(', ')})`
    )
    params.push(...filePaths)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db
    .prepare(
      `SELECT DISTINCT reviews.* FROM reviews
       ${joins.join(' ')}
       ${whereClause}
       ORDER BY reviews.created_at DESC`
    )
    .all(...params) as unknown as ReviewRow[]
  const reviews = rows.map(rowToReview)

  // Done in JS, not SQL `LOWER()`/`NOCASE` (ASCII-only in SQLite without the
  // ICU extension) — `String.prototype.toLowerCase()` handles Cyrillic and
  // other non-ASCII scripts correctly (see ADR 0017).
  if (!search) {
    return reviews
  }
  const needle = search.toLowerCase()
  return reviews.filter(review => review.name?.toLowerCase().includes(needle))
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
