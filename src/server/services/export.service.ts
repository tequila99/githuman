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
import { getFileAtRef } from './git.service.ts'

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

function filePathOf(file: DiffFile): string {
  return file.newPath || file.oldPath
}

/**
 * A fence one backtick longer than the longest backtick run inside `text`, so
 * code or a suggestion that itself contains ``` can't close the block early.
 */
function fenceFor(text: string): string {
  return '`'.repeat(Math.max(3, longestBacktickRun(text) + 1))
}

function longestBacktickRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length))
}

/** Inline code that survives backticks in `text` (legal in git paths). */
function inlineCode(text: string): string {
  const delimiter = '`'.repeat(longestBacktickRun(text) + 1)
  // CommonMark strips one space from each end when both ends have one.
  const pad =
    text.startsWith('`') ||
    text.endsWith('`') ||
    (text.startsWith(' ') && text.endsWith(' '))
      ? ' '
      : ''
  return `${delimiter}${pad}${text}${pad}${delimiter}`
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * `lineNumberEnd` is null on comments saved before ranges existed (ADR 0017).
 * Line 0 is how the API used to store a whole-file comment's null (a type
 * coercion bug, since fixed), so existing databases still contain it.
 */
function rangeOf(comment: Comment): [number, number] | null {
  if (comment.lineNumber === null || comment.lineNumber <= 0) return null
  return [comment.lineNumber, comment.lineNumberEnd ?? comment.lineNumber]
}

function rangeLabel([start, end]: [number, number]): string {
  return start === end ? `Строка ${start}` : `Строки ${start}–${end}`
}

/**
 * The snapshot lines a diff comment covers — exactly the lines whose number in
 * the comment's anchor column falls in its range, like ReviewDetailPage's
 * comments-only view. The anchor column follows DiffHunkView.vue: 'removed'
 * comments count old-side line numbers, everything else new-side.
 */
function diffLinesFor(
  file: DiffFile | undefined,
  comment: Comment,
  [start, end]: [number, number]
): { lines: string[]; position: number } {
  const out: string[] = []
  // Where the first covered line sits in the snapshot: old- and new-side
  // numbers aren't comparable, so items are ordered by this instead.
  let position = Number.MAX_SAFE_INTEGER
  if (!file) return { lines: out, position }
  const numberOf = (line: DiffLine) =>
    comment.lineType === 'removed' ? line.oldLineNumber : line.newLineNumber

  let offset = 0
  for (const hunk of file.hunks) {
    const covered = hunk.lines.flatMap((line, index) => {
      const n = numberOf(line)
      return n !== null && n >= start && n <= end ? [{ line, index }] : []
    })
    if (covered.length > 0) {
      position = Math.min(position, offset + covered[0].index)
      // A range spanning hunks (not possible from the UI) keeps the gap visible.
      if (out.length > 0) out.push('@@ … @@')
      for (const { line } of covered) {
        out.push(`${diffLinePrefix(line)}${line.content}`)
      }
    }
    offset += hunk.lines.length
  }
  return { lines: out, position }
}

/** A trailing newline doesn't start another line; CRLF endings are dropped. */
function splitFileLines(content: string): string[] {
  const lines = content.split('\n').map(line => line.replace(/\r$/, ''))
  if (lines.at(-1) === '') lines.pop()
  return lines
}

interface ReportItem {
  heading: string
  code: { lang: string; lines: string[] } | null
  missingNote: string | null
  comment: Comment
}

function indentBlock(text: string, indent: string): string[] {
  return text.split('\n').map(line => (line === '' ? '' : `${indent}${line}`))
}

function renderItem(item: ReportItem, index: number): string[] {
  const marker = `${index + 1}. `
  const indent = ' '.repeat(marker.length)
  const out = [`${marker}${item.heading}`]

  if (item.code) {
    const body = item.code.lines.join('\n')
    const fence = fenceFor(body)
    out.push('')
    out.push(`${indent}${fence}${item.code.lang}`)
    out.push(...item.code.lines.map(line => `${indent}${line}`))
    out.push(`${indent}${fence}`)
  } else if (item.missingNote) {
    out.push('')
    out.push(`${indent}_${item.missingNote}_`)
  }

  out.push('')
  out.push(...indentBlock(item.comment.content, indent))

  if (item.comment.suggestion) {
    const fence = fenceFor(item.comment.suggestion)
    out.push('')
    out.push(`${indent}Предложение:`)
    out.push('')
    out.push(`${indent}${fence}`)
    out.push(...item.comment.suggestion.split('\n').map(l => `${indent}${l}`))
    out.push(`${indent}${fence}`)
  }

  out.push('')
  return out
}

/**
 * Renders only the *open* comments, grouped by file: each comment becomes a
 * numbered item with just the code it's about, then its text (#30). Diff
 * comments take their lines from the review's frozen diff snapshot;
 * full-file comments (lineType null) from `fileLines`, the file as currently
 * on disk — the same exception to "review = frozen snapshot" the full-file
 * view in the UI makes. A null entry means the file couldn't be read.
 */
export function formatReviewAsMarkdown(
  review: Review,
  files: DiffFile[],
  comments: Comment[],
  fileLines: Map<string, string[] | null> = new Map()
): string {
  const lines: string[] = []

  // A user-given name may contain newlines; keep it on the heading line.
  const title = (review.name ?? review.repositoryPath).replace(
    /\s*[\r\n]+\s*/g,
    ' '
  )
  lines.push(`# Ревью: ${title}`)
  lines.push('')
  lines.push(`- Репозиторий: ${review.repositoryPath}`)
  lines.push(
    `- Источник: ${review.sourceType}${review.sourceRef ? ` (${review.sourceRef})` : ''}`
  )
  lines.push(`- Статус: ${STATUS_LABELS[review.status]}`)
  lines.push(`- Создано: ${review.createdAt}`)
  lines.push('')

  const open = comments.filter(comment => !comment.resolved)
  if (open.length === 0) {
    lines.push('Открытых замечаний нет.')
    lines.push('')
    return lines.join('\n')
  }

  const filesByPath = new Map(files.map(file => [filePathOf(file), file]))
  const byFile = new Map<string, Comment[]>()
  for (const comment of open) {
    const list = byFile.get(comment.filePath)
    if (list) list.push(comment)
    else byFile.set(comment.filePath, [comment])
  }
  // Snapshot order first; a commented file missing from the snapshot still
  // gets its section rather than silently dropping the comment.
  const paths = [
    ...files.map(filePathOf).filter(path => byFile.has(path)),
    ...[...byFile.keys()].filter(path => !filesByPath.has(path))
  ]

  for (const path of paths) {
    const file = filesByPath.get(path)
    const items: Array<ReportItem & { order: number }> = []

    for (const comment of byFile.get(path) ?? []) {
      const range = rangeOf(comment)
      if (!range) {
        items.push({
          heading: 'Файл целиком',
          code: null,
          missingNote: null,
          comment,
          order: -1
        })
        continue
      }

      if (comment.lineType === null) {
        const content = fileLines.get(path) ?? null
        const [start, end] = range
        const available =
          content !== null && start <= end && end <= content.length
        items.push({
          heading: `${rangeLabel(range)} (файл целиком)`,
          code: available
            ? { lang: extensionOf(path), lines: content.slice(start - 1, end) }
            : null,
          missingNote: available
            ? null
            : 'Этих строк нет в текущей версии файла — код не показан',
          comment,
          // After all diff comments, in file-line order.
          order: Number.MAX_SAFE_INTEGER / 2 + start
        })
        continue
      }

      const { lines: code, position } = diffLinesFor(file, comment, range)
      items.push({
        heading: rangeLabel(range),
        code: code.length > 0 ? { lang: 'diff', lines: code } : null,
        missingNote: code.length > 0 ? null : 'Строки не найдены в снимке diff',
        comment,
        order: code.length > 0 ? position : Number.MAX_SAFE_INTEGER / 4
      })
    }

    items.sort((a, b) => a.order - b.order)

    lines.push(`## ${inlineCode(path)}`)
    lines.push('')
    items.forEach((item, index) => lines.push(...renderItem(item, index)))
  }

  return lines.join('\n')
}

/**
 * `repositoryPath` is the repository this server/CLI runs on — full-file
 * comments are read from its working tree, not from the path stored with
 * the review, which goes stale if the repository was moved.
 */
export async function exportAsMarkdown(
  db: DatabaseSync,
  reviewId: string,
  repositoryPath: string
): Promise<string> {
  const review = getReviewOrThrow(db, reviewId)
  const comments = listCommentsByReview(db, reviewId)
  const files: DiffFile[] = JSON.parse(review.snapshotData)

  const fullFilePaths = new Set(
    comments
      .filter(c => !c.resolved && c.lineType === null && rangeOf(c) !== null)
      .map(c => c.filePath)
  )
  const fileLines = new Map(
    await Promise.all(
      [...fullFilePaths].map(async path => {
        try {
          const { content, isBinary } = await getFileAtRef(
            repositoryPath,
            'WORKTREE',
            path
          )
          return [path, isBinary ? null : splitFileLines(content)] as const
        } catch {
          return [path, null] as const
        }
      })
    )
  )

  return formatReviewAsMarkdown(review, files, comments, fileLines)
}
