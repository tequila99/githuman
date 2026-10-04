// A hunk or file with more rows than this mounts its rows in segments (ADR 0032).
export const SEGMENT_THRESHOLD = 200

// Rows in one segment. A segment mounts or unmounts as a whole.
export const SEGMENT_SIZE = 100

// Height of one code row in px. It matches `line-height` in DiffLineRow and FileContentLine.
export const ROW_HEIGHT = 20

export interface RowGroup<T> {
  /** Index of the first row of the group in the source list. */
  start: number
  rows: T[]
}

/**
 * Splits rows into segments. A short list stays one group, and the caller
 * mounts that group without a visibility check.
 */
export function groupRows<T>(rows: readonly T[]): {
  segmented: boolean
  groups: RowGroup<T>[]
} {
  if (rows.length <= SEGMENT_THRESHOLD) {
    return { segmented: false, groups: [{ start: 0, rows: [...rows] }] }
  }
  const groups: RowGroup<T>[] = []
  for (let start = 0; start < rows.length; start += SEGMENT_SIZE) {
    groups.push({ start, rows: rows.slice(start, start + SEGMENT_SIZE) })
  }
  return { segmented: true, groups }
}
