import type { DatabaseSync } from 'node:sqlite'
import type { Comment, CreateCommentRequest } from '../../shared/types.ts'
import {
  createComment as insertComment,
  findCommentById,
  listCommentsByReview,
  updateComment as updateCommentRepo,
  deleteComment as deleteCommentRepo,
  setCommentResolved
} from '../repositories/comment.repo.ts'
import type { EventBus } from '../event-bus.ts'

export class ValidationError extends Error {}

export function createComment(
  db: DatabaseSync,
  reviewId: string,
  input: CreateCommentRequest,
  eventBus?: EventBus
): Comment {
  if (!input.content) {
    throw new ValidationError('"content" is required')
  }

  const now = new Date().toISOString()
  const comment: Comment = {
    id: crypto.randomUUID(),
    reviewId,
    filePath: input.filePath,
    lineNumber: input.lineNumber ?? null,
    lineNumberEnd: input.lineNumberEnd ?? input.lineNumber ?? null,
    lineType: input.lineType ?? null,
    content: input.content,
    createdAt: now,
    updatedAt: now,
    suggestion: input.suggestion ?? null
  }

  const created = insertComment(db, comment)
  eventBus?.publish({ type: 'comment:created', reviewId })
  return created
}

export function getComments(db: DatabaseSync, reviewId: string): Comment[] {
  return listCommentsByReview(db, reviewId)
}

export function editComment(
  db: DatabaseSync,
  id: string,
  content: string,
  eventBus?: EventBus
): Comment | null {
  if (!content) {
    throw new ValidationError('"content" is required')
  }

  const updated = updateCommentRepo(db, id, content)
  if (updated) {
    eventBus?.publish({ type: 'comment:updated', reviewId: updated.reviewId })
  }
  return updated
}

export function resolveComment(
  db: DatabaseSync,
  id: string,
  eventBus?: EventBus
): Comment | null {
  const updated = setCommentResolved(db, id, true)
  if (updated) {
    eventBus?.publish({ type: 'comment:updated', reviewId: updated.reviewId })
  }
  return updated
}

export function unresolveComment(
  db: DatabaseSync,
  id: string,
  eventBus?: EventBus
): Comment | null {
  const updated = setCommentResolved(db, id, false)
  if (updated) {
    eventBus?.publish({ type: 'comment:updated', reviewId: updated.reviewId })
  }
  return updated
}

export function removeComment(
  db: DatabaseSync,
  id: string,
  eventBus?: EventBus
): void {
  const comment = findCommentById(db, id)
  deleteCommentRepo(db, id)
  if (comment) {
    eventBus?.publish({ type: 'comment:deleted', reviewId: comment.reviewId })
  }
}
