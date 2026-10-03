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
