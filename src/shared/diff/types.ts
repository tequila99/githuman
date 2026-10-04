/**
 * Shared types between server and web client
 */

export type DiffLineType = 'added' | 'removed' | 'context'

export interface DiffLine {
  type: DiffLineType
  content: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export type DiffFileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface DiffFile {
  oldPath: string
  newPath: string
  status: DiffFileStatus
  additions: number
  deletions: number
  isBinary: boolean
  hunks: DiffHunk[]
}

/** Diff source behind `/api/diff/:source/files` and `/api/diff/:source/file`. */
export type DiffSourceName = 'staged' | 'unstaged'

/** A diff file without hunks (ADR 0033). */
export interface DiffFileSummary {
  oldPath: string
  newPath: string
  status: DiffFileStatus
  additions: number
  deletions: number
  isBinary: boolean
  /** Changes whenever the file content or its diff changes. Equal signatures mean equal hunks. */
  signature: string
}
