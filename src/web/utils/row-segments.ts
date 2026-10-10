import type { Comment, DiffHunk } from '@/api/types'

// A file view with more rows than this mounts its rows in segments (ADR 0032).
// The diff segments every hunk and gives a threshold of 0 (ADR 0040).
export const SEGMENT_THRESHOLD = 200

// Rows in one segment. A segment mounts or unmounts as a whole. Small segments
// keep the mount of one segment inside the row budget of a frame (ADR 0040).
export const SEGMENT_SIZE = 25

// Height of one code row in px. It matches `line-height` in DiffLineRow and FileContentLine.
export const ROW_HEIGHT = 20

// The hunk header has a 21px line box and 2px padding on each side.
export const HUNK_HEADER_HEIGHT = 25

// Height guess for one comment thread in px, until the segment is measured.
export const THREAD_HEIGHT_ESTIMATE = 90

// Mount cost of one comment thread, in rows. A thread has buttons and a menu.
export const THREAD_COST = 10

// Mount cost of one segment itself, in rows: its component, its observer and its
// placeholder. With this cost, one frame does not mount many small segments.
export const SEGMENT_COST = 10

export interface RowGroup<T> {
  /** Index of the first row of the group in the source list. */
  start: number
  rows: T[]
}

/**
 * Splits rows into segments. A list not longer than `threshold` stays one
 * group, and the caller mounts that group without a visibility check.
 */
export function groupRows<T>(
  rows: readonly T[],
  threshold = SEGMENT_THRESHOLD
): {
  segmented: boolean
  groups: RowGroup<T>[]
} {
  if (rows.length <= threshold) {
    return { segmented: false, groups: [{ start: 0, rows: [...rows] }] }
  }
  const groups: RowGroup<T>[] = []
  for (let start = 0; start < rows.length; start += SEGMENT_SIZE) {
    groups.push({ start, rows: rows.slice(start, start + SEGMENT_SIZE) })
  }
  return { segmented: true, groups }
}

/** Placeholder height and mount cost of a segment with `threads` comment threads. */
export function segmentSize(rows: number, threads: number) {
  return {
    minHeight: rows * ROW_HEIGHT + threads * THREAD_HEIGHT_ESTIMATE,
    cost: SEGMENT_COST + rows + threads * THREAD_COST
  }
}

export function hunkHeightEstimate(
  hunk: DiffHunk,
  bodyHeight = hunk.lines.length * ROW_HEIGHT
): number {
  return bodyHeight + HUNK_HEADER_HEIGHT
}

export function rowSegmentProps<T>(
  group: RowGroup<T>,
  options: {
    comments: (row: T) => readonly Comment[]
    hasForm: (row: T) => boolean
    owner: object
    wrap: boolean
    commentsEditable: boolean
    slot?: string
    cacheHeight?: boolean
  }
) {
  let keep = false
  const threads: Array<readonly [number, boolean, readonly Comment[]]> = []
  for (const [index, row] of group.rows.entries()) {
    const comments = options.comments(row)
    const form = options.hasForm(row)
    keep ||= form
    if (comments.length > 0 || form) threads.push([index, form, comments])
  }
  const dynamic = threads.length > 0
  return {
    ...segmentSize(group.rows.length, threads.length),
    keep,
    heightOwner: options.owner,
    heightKey: options.slot ?? `rows:${group.start}`,
    // Full content and positions distinguish geometry even at equal text lengths.
    heightVersion: JSON.stringify([
      group.rows.length,
      options.wrap,
      options.commentsEditable,
      threads.map(([index, form, comments]) => [
        index,
        form,
        comments.map(comment => [
          comment.id,
          comment.content,
          comment.suggestion,
          !!comment.resolved
        ])
      ])
    ]),
    cacheHeight: (options.cacheHeight ?? true) && !options.wrap && !dynamic,
    widthSensitive: options.wrap || dynamic
  }
}
