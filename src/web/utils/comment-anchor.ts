import type { DiffLine } from '@/api/types'

/**
 * Where an unsent comment form is attached. The line numbers alone are not enough:
 * after an edit of the file, the same numbers can point to other text. The anchor
 * also keeps the text of the selected lines, and it is valid only while that text
 * stays at those numbers.
 */
export interface CommentAnchor {
  /** Gutter column of the line numbers: `old`/`new` in a diff, `full` in a full file. */
  column: string
  startKey: number
  endKey: number
  fingerprint: string
}

/** One row as the anchor sees it: its number in the anchor column and its text. */
export interface AnchorLine {
  key: number | null
  text: string
}

function selectedTexts(
  lines: readonly AnchorLine[],
  startKey: number,
  endKey: number
): string[] {
  return lines
    .filter(
      line => line.key !== null && line.key >= startKey && line.key <= endKey
    )
    .map(line => line.text)
}

export function createAnchor(
  column: string,
  startKey: number,
  endKey: number,
  lines: readonly AnchorLine[]
): CommentAnchor {
  return {
    column,
    startKey,
    endKey,
    fingerprint: JSON.stringify(selectedTexts(lines, startKey, endKey))
  }
}

/**
 * Compares an anchor with the rows of one hunk or one file.
 * - `absent`: the last line of the anchor is not in these rows. Another hunk may own it.
 * - `valid`: the selected lines are here with the same text.
 * - `stale`: the line numbers are here, but the text changed.
 */
export function checkAnchor(
  anchor: CommentAnchor,
  lines: readonly AnchorLine[]
): 'absent' | 'valid' | 'stale' {
  if (!lines.some(line => line.key === anchor.endKey)) return 'absent'
  const fingerprint = JSON.stringify(
    selectedTexts(lines, anchor.startKey, anchor.endKey)
  )
  return fingerprint === anchor.fingerprint ? 'valid' : 'stale'
}

export function anchorEndsAt(
  anchor: CommentAnchor | null,
  column: string,
  key: number | null
): boolean {
  return (
    anchor !== null &&
    key !== null &&
    anchor.column === column &&
    anchor.endKey === key
  )
}

export function diffAnchorEndsAt(
  anchor: CommentAnchor | null,
  line: Pick<DiffLine, 'oldLineNumber' | 'newLineNumber'>
): boolean {
  return (
    anchorEndsAt(anchor, 'old', line.oldLineNumber) ||
    anchorEndsAt(anchor, 'new', line.newLineNumber)
  )
}
