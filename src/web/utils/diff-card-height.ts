import type { Comment, DiffFile } from '@/api/types'
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

export function diffCardBodyHeight(file: DiffFile, detail?: DiffFile): number {
  return detail
    ? detail.hunks.reduce((sum, hunk) => sum + hunkHeightEstimate(hunk), 0)
    : (file.additions + file.deletions) * ROW_HEIGHT + HUNK_HEADERS_ESTIMATE
}

/** Counts branches rather than individual comments while only a shell exists. */
export function commentHeightEstimate(
  comments: readonly Comment[],
  mode: 'diff' | 'full'
): number {
  if (mode === 'full')
    return (
      commentsByLine(comments.filter(c => c.lineType === null)).size *
      THREAD_HEIGHT_ESTIMATE
    )
  const threads = diffCommentThreads(comments.filter(c => c.lineType !== null))
  return (threads.old.size + threads.new.size) * THREAD_HEIGHT_ESTIMATE
}
