import type { DatabaseSync } from 'node:sqlite'

/**
 * Denormalized index of file paths touched by a review's snapshot, used only
 * to filter the review list by file (see ADR 0017). Not a source of truth —
 * `reviews.snapshot_data` remains the only source of truth for diff rendering.
 */
export function insertReviewFiles(
  db: DatabaseSync,
  reviewId: string,
  filePaths: string[]
): void {
  if (filePaths.length === 0) {
    return
  }
  const stmt = db.prepare(
    'INSERT INTO review_files (review_id, file_path) VALUES (?, ?)'
  )
  for (const filePath of filePaths) {
    stmt.run(reviewId, filePath)
  }
}

export function deleteReviewFiles(db: DatabaseSync, reviewId: string): void {
  db.prepare('DELETE FROM review_files WHERE review_id = ?').run(reviewId)
}
