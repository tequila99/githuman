import type { Comment, DiffFile } from '@/api/types'
import type { CommentAnchor } from '@/utils/comment-anchor'
import { commentsByLine, diffCommentThreads } from '@/utils/comment-threads'
import {
  ROW_HEIGHT,
  THREAD_HEIGHT_ESTIMATE,
  hunkHeightEstimate
} from '@/utils/row-segments'

// Covers context rows and headers before the hunks arrive.
const HUNK_HEADERS_ESTIMATE = 80
// Matches the virtual list's closed-card estimate, including the frame border.
export const CARD_HEIGHT_ESTIMATE = 46

export function diffCardBodyHeight(
  file: DiffFile,
  detail?: DiffFile,
  rowHeight = ROW_HEIGHT
): number {
  return detail
    ? detail.hunks.reduce(
        (sum, hunk) =>
          sum + hunkHeightEstimate(hunk, hunk.lines.length * rowHeight),
        0
      )
    : (file.additions + file.deletions) * rowHeight + HUNK_HEADERS_ESTIMATE
}

/** Counts branches rather than individual comments while only a shell exists. */
export function commentHeightEstimate(
  comments: readonly Comment[],
  mode: 'diff' | 'full'
): number {
  if (mode === 'full') {
    return (
      commentsByLine(comments.filter(c => c.lineType === null)).size *
      THREAD_HEIGHT_ESTIMATE
    )
  }
  const threads = diffCommentThreads(comments.filter(c => c.lineType !== null))
  return (threads.old.size + threads.new.size) * THREAD_HEIGHT_ESTIMATE
}

/**
 * Version of a measured card height. Equal versions must mean equal card geometry.
 * The row height is part of it: the root width can be equal in the narrow and the wide layout.
 */
export function cardShellVersion(state: {
  expanded: boolean
  mode: 'diff' | 'full'
  wrap: boolean
  activeReview: boolean
  rowHeight: number
  pending: Pick<CommentAnchor, 'column' | 'startKey' | 'endKey'> | null
  comments: readonly Comment[] | undefined
}): string {
  return JSON.stringify([
    state.expanded,
    state.mode,
    state.wrap,
    state.activeReview,
    state.rowHeight,
    state.pending
      ? [state.pending.column, state.pending.startKey, state.pending.endKey]
      : null,
    state.comments?.map(comment => [
      comment.id,
      comment.lineType,
      comment.lineNumberEnd,
      comment.content,
      comment.suggestion,
      comment.resolved
    ])
  ])
}
