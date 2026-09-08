import type { DatabaseSync } from 'node:sqlite'
import type { Comment, DiffLineType } from '../../shared/types.ts'

interface CommentRow {
  id: string
  review_id: string
  file_path: string
  line_number: number | null
  line_type: DiffLineType | null
  content: string
  created_at: string
  updated_at: string
  resolved: number
  suggestion: string | null
}

function rowToComment(row: CommentRow): Comment {
  return {
    id: row.id,
    reviewId: row.review_id,
    filePath: row.file_path,
    lineNumber: row.line_number,
    lineType: row.line_type,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolved: Boolean(row.resolved),
    suggestion: row.suggestion
  }
}

export function findCommentById(db: DatabaseSync, id: string): Comment | null {
  const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as
    | CommentRow
    | undefined
  return row ? rowToComment(row) : null
}

export function createComment(db: DatabaseSync, comment: Comment): Comment {
  db.prepare(
    `INSERT INTO comments (id, review_id, file_path, line_number, line_type, content, created_at, updated_at, suggestion)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    comment.id,
    comment.reviewId,
    comment.filePath,
    comment.lineNumber,
    comment.lineType,
    comment.content,
    comment.createdAt,
    comment.updatedAt,
    comment.suggestion ?? null
  )

  return findCommentById(db, comment.id)!
}

export function listCommentsByReview(
  db: DatabaseSync,
  reviewId: string
): Comment[] {
  const rows = db
    .prepare(
      'SELECT * FROM comments WHERE review_id = ? ORDER BY created_at ASC'
    )
    .all(reviewId) as unknown as CommentRow[]
  return rows.map(rowToComment)
}

export function updateComment(
  db: DatabaseSync,
  id: string,
  content: string
): Comment | null {
  const updatedAt = new Date().toISOString()
  const result = db
    .prepare('UPDATE comments SET content = ?, updated_at = ? WHERE id = ?')
    .run(content, updatedAt, id)

  if (result.changes === 0) {
    return null
  }

  return findCommentById(db, id)
}

export function deleteComment(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM comments WHERE id = ?').run(id)
}

export function setCommentResolved(
  db: DatabaseSync,
  id: string,
  resolved: boolean
): Comment | null {
  const updatedAt = new Date().toISOString()
  const result = db
    .prepare('UPDATE comments SET resolved = ?, updated_at = ? WHERE id = ?')
    .run(resolved ? 1 : 0, updatedAt, id)

  if (result.changes === 0) {
    return null
  }

  return findCommentById(db, id)
}
