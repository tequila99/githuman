import type { DatabaseSync } from 'node:sqlite'
import type {
  CreateReviewRequest,
  DiffFile,
  Review,
  ReviewSourceType,
  ReviewStatus
} from '../../shared/types.ts'
import {
  createReview as insertReview,
  findReviewById,
  listReviews,
  updateReviewStatus as updateReviewStatusRepo,
  deleteReview as deleteReviewRepo,
  UniqueNameError,
  type ListReviewsFilters
} from '../repositories/review.repo.ts'
import {
  listCommentsByReview,
  deleteComment
} from '../repositories/comment.repo.ts'
import {
  insertReviewFiles,
  deleteReviewFiles
} from '../repositories/review-file.repo.ts'
import {
  getStagedDiff,
  getUnstagedDiff,
  getBranchDiff,
  getCommitsDiff
} from './diff.service.ts'
import { getRepositoryInfo } from './git.service.ts'
import type { EventBus } from '../event-bus.ts'

export class ValidationError extends Error {}

const REVIEW_NAME_MONTHS_RU = [
  'янв',
  'февр',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сент',
  'окт',
  'нояб',
  'дек'
]

function formatReviewDate(date: Date): string {
  const day = date.getDate()
  const month = REVIEW_NAME_MONTHS_RU[date.getMonth()]
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${day} ${month}, ${hours}:${minutes}`
}

function reviewSourceLabel(
  sourceType: ReviewSourceType,
  sourceRef: string | null,
  baseRef: string | null
): string {
  if (sourceType === 'local') {
    return 'Local changes'
  }
  if (sourceType === 'staged') {
    return 'Staged'
  }
  if (sourceType === 'unstaged') {
    return 'Unstaged'
  }
  if (sourceType === 'branch') {
    return sourceRef ?? baseRef ?? 'Branch'
  }
  if (sourceRef) {
    const commits = sourceRef.split(',')
    return commits.length === 1
      ? `Commit ${commits[0].slice(0, 8)}`
      : `${commits.length} commits`
  }
  return 'Review'
}

/** Auto-generated name shown when the user doesn't provide one — "source + date/time" (see ADR 0017). */
function generateReviewName(
  sourceType: ReviewSourceType,
  sourceRef: string | null,
  baseRef: string | null,
  now: Date
): string {
  return `${reviewSourceLabel(sourceType, sourceRef, baseRef)} — ${formatReviewDate(now)}`
}

function extractFilePaths(snapshot: DiffFile[]): string[] {
  return snapshot.map(file => file.newPath || file.oldPath)
}

export async function createReview(
  db: DatabaseSync,
  repositoryPath: string,
  input: CreateReviewRequest,
  eventBus?: EventBus
): Promise<Review> {
  const sourceType = input.sourceType ?? 'local'

  let snapshot
  let baseRef: string | null = null
  let sourceRef: string | null = null

  if (sourceType === 'local') {
    // Both diffs together — a review's comments apply regardless of which
    // tab they were left on, so its snapshot (read-only /reviews/:id view,
    // and the file-path filter in the reviews list) needs both too.
    const [staged, unstaged] = await Promise.all([
      getStagedDiff(repositoryPath),
      getUnstagedDiff(repositoryPath)
    ])
    snapshot = [...staged, ...unstaged]
  } else if (sourceType === 'staged') {
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

  const now = new Date()
  const nowIso = now.toISOString()
  const { branch } = await getRepositoryInfo(repositoryPath)
  const userProvidedName = input.name?.trim()
  const baseName =
    userProvidedName || generateReviewName(sourceType, sourceRef, baseRef, now)
  const filePaths = extractFilePaths(snapshot)
  const id = crypto.randomUUID()

  // A user-chosen name that collides is surfaced as a ValidationError — the
  // user decides what to do. An auto-generated name (e.g. two "Staged"
  // reviews created within the same minute) collides on nothing the user
  // chose, so it's disambiguated automatically instead (see ADR 0017).
  const maxAttempts = userProvidedName ? 1 : 20
  let created: Review | undefined
  let lastError: UniqueNameError | undefined
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const name = attempt === 0 ? baseName : `${baseName} (${attempt + 1})`
    const review: Review = {
      id,
      repositoryPath,
      baseRef,
      sourceType,
      sourceRef,
      snapshotData: JSON.stringify(snapshot),
      status: 'in_progress',
      name,
      branch,
      createdAt: nowIso,
      updatedAt: nowIso
    }

    db.exec('BEGIN')
    try {
      created = insertReview(db, review)
      insertReviewFiles(db, id, filePaths)
      db.exec('COMMIT')
      break
    } catch (error) {
      db.exec('ROLLBACK')
      if (!(error instanceof UniqueNameError)) {
        throw error
      }
      lastError = error
    }
  }

  if (!created) {
    if (userProvidedName) {
      throw new ValidationError(lastError!.message)
    }
    throw lastError
  }

  eventBus?.publish({ type: 'review:created', reviewId: created.id })
  return created
}

export function getReview(db: DatabaseSync, id: string): Review | null {
  return findReviewById(db, id)
}

export function getReviews(
  db: DatabaseSync,
  filters: ListReviewsFilters = {}
): Review[] {
  return listReviews(db, filters)
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
  deleteReviewFiles(db, id)
  deleteReviewRepo(db, id)
  eventBus?.publish({ type: 'review:deleted', reviewId: id })
}
