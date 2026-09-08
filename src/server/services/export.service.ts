import type { DatabaseSync } from 'node:sqlite'
import type {
  Comment,
  DiffFile,
  DiffLine,
  Review,
  ReviewStatus
} from '../../shared/types.ts'
import { findReviewById } from '../repositories/review.repo.ts'
import { listCommentsByReview } from '../repositories/comment.repo.ts'

export class ExportNotFoundError extends Error {}

const STATUS_LABELS: Record<ReviewStatus, string> = {
  in_progress: 'в процессе',
  approved: 'одобрено',
  changes_requested: 'нужны правки'
}

function getReviewOrThrow(db: DatabaseSync, reviewId: string): Review {
  const review = findReviewById(db, reviewId)
  if (!review) {
    throw new ExportNotFoundError(`Review ${reviewId} not found`)
  }
  return review
}

export function exportAsJson(
  db: DatabaseSync,
  reviewId: string
): { review: Review; comments: Comment[] } {
  const review = getReviewOrThrow(db, reviewId)
  const comments = listCommentsByReview(db, reviewId)
  return { review, comments }
}

function diffLinePrefix(line: DiffLine): string {
  if (line.type === 'added') return '+'
  if (line.type === 'removed') return '-'
  return ' '
}

export function formatReviewAsMarkdown(
  review: Review,
  files: DiffFile[],
  comments: Comment[]
): string {
  const lines: string[] = []

  lines.push(`# Ревью: ${review.repositoryPath}`)
  lines.push('')
  lines.push(
    `- Источник: ${review.sourceType}${review.sourceRef ? ` (${review.sourceRef})` : ''}`
  )
  lines.push(`- Статус: ${STATUS_LABELS[review.status]}`)
  lines.push(`- Создано: ${review.createdAt}`)
  lines.push('')

  const commentsByFile = new Map<string, Comment[]>()
  for (const comment of comments) {
    const existing = commentsByFile.get(comment.filePath) ?? []
    commentsByFile.set(comment.filePath, [...existing, comment])
  }

  for (const file of files) {
    lines.push(`## ${file.newPath} (+${file.additions}/-${file.deletions})`)
    lines.push('')
    lines.push('```diff')
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        lines.push(`${diffLinePrefix(line)}${line.content}`)
      }
    }
    lines.push('```')
    lines.push('')

    const fileComments = commentsByFile.get(file.newPath) ?? []
    if (fileComments.length > 0) {
      lines.push('**Комментарии:**')
      lines.push('')
      for (const comment of fileComments) {
        const location =
          comment.lineNumber !== null ? `Строка ${comment.lineNumber}` : 'Файл'
        lines.push(`- ${location}: ${comment.content}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

export function exportAsMarkdown(db: DatabaseSync, reviewId: string): string {
  const review = getReviewOrThrow(db, reviewId)
  const comments = listCommentsByReview(db, reviewId)
  const files: DiffFile[] = JSON.parse(review.snapshotData)
  return formatReviewAsMarkdown(review, files, comments)
}
