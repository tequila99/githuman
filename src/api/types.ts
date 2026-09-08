/**
 * Types shared with the githuman backend API.
 * Mirrors src/shared/types.ts in the githuman repo.
 */

export interface RepositoryInfo {
  name: string
  branch: string
  remote: string | null
  path: string
}

export type DiffFileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

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

export interface DiffFile {
  oldPath: string
  newPath: string
  status: DiffFileStatus
  additions: number
  deletions: number
  isBinary: boolean
  hunks: DiffHunk[]
}

export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  isChanged: boolean
  children?: FileTreeNode[] | undefined
}

export interface FileTreeResponse {
  ref: string
  files: string[]
}

export interface FileContentResponse {
  path: string
  ref: string
  content: string
  lines: string[]
  lineCount: number
  isBinary: boolean
}

export interface ApiError {
  error: string
  message: string
  statusCode: number
}
