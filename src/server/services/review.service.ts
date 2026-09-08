import type { DatabaseSync } from 'node:sqlite'
import type {
  CreateReviewRequest,
  Review,
  ReviewStatus
} from '../../shared/types.ts'
import {
  createReview as insertReview,
  findReviewById,
  listReviews,
  updateReviewStatus as updateReviewStatusRepo,
  deleteReview as deleteReviewRepo
} from '../repositories/review.repo.ts'
import {
  listCommentsByReview,
  deleteComment
} from '../repositories/comment.repo.ts'
import {
  getStagedDiff,
  getUnstagedDiff,
  getBranchDiff,
  getCommitsDiff
} from './diff.service.ts'
import type { EventBus } from '../event-bus.ts'

export class ValidationError extends Error {}

export async function createReview(
  db: DatabaseSync,
  repositoryPath: string,
  input: CreateReviewRequest,
  eventBus?: EventBus
): Promise<Review> {
  const sourceType = input.sourceType ?? 'staged'

  let snapshot
  let baseRef: string | null = null
  let sourceRef: string | null = null

  if (sourceType === 'staged') {
    snapshot = await getStagedDiff(repositoryPath)
  } else if (sourceType === 'unstaged') {
    snapshot = await getUnstagedDiff(repositoryPath)
  } else if (sourceType === 'branch') {
    if (!input.baseRef) {
      throw new ValidationError(
        '"baseRef" is required when sourceType is "branch"'
      )
    }
    baseRef = input.baseRef
    sourceRef = input.sourceRef ?? null
    snapshot = await getBranchDiff(repositoryPath, input.baseRef)
  } else if (sourceType === 'commits') {
    if (!input.baseRef || !input.sourceRef) {
      throw new ValidationError(
        '"baseRef" (from) and "sourceRef" (to) are both required when sourceType is "commits"'
      )
    }
    baseRef = input.baseRef
    sourceRef = input.sourceRef
    snapshot = await getCommitsDiff(
      repositoryPath,
      input.baseRef,
      input.sourceRef
    )
  } else {
    throw new ValidationError(`Unknown sourceType: "${String(sourceType)}"`)
  }

  const now = new Date().toISOString()
  const review: Review = {
    id: crypto.randomUUID(),
    repositoryPath,
    baseRef,
    sourceType,
    sourceRef,
    snapshotData: JSON.stringify(snapshot),
    status: 'in_progress',
    createdAt: now,
    updatedAt: now
  }

  const created = insertReview(db, review)
  eventBus?.publish({ type: 'review:created', reviewId: created.id })
  return created
}

export function getReview(db: DatabaseSync, id: string): Review | null {
  return findReviewById(db, id)
}

export function getReviews(db: DatabaseSync): Review[] {
  return listReviews(db)
}

export function setReviewStatus(
  db: DatabaseSync,
  id: string,
  status: ReviewStatus,
  eventBus?: EventBus
): Review | null {
  const updated = updateReviewStatusRepo(db, id, status)
  if (updated) {
    eventBus?.publish({ type: 'review:updated', reviewId: updated.id })
  }
  return updated
}

export function removeReview(
  db: DatabaseSync,
  id: string,
  eventBus?: EventBus
): void {
  for (const comment of listCommentsByReview(db, id)) {
    deleteComment(db, comment.id)
  }
  deleteReviewRepo(db, id)
  eventBus?.publish({ type: 'review:deleted', reviewId: id })
}
