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

export interface RepositoryInfo {
  name: string
  branch: string
  remote: string | null
  path: string
}

export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  isChanged: boolean
  children?: FileTreeNode[]
}

export interface FileTreeResponse {
  ref: string
  files: string[]
}

export interface FileContentAtRef {
  path: string
  ref: string
  content: string
  lines: string[]
  lineCount: number
  isBinary: boolean
}

export type ReviewStatus = 'in_progress' | 'approved' | 'changes_requested'
export type ReviewSourceType = 'staged' | 'unstaged' | 'branch' | 'commits'

export interface Review {
  id: string
  repositoryPath: string
  baseRef: string | null
  sourceType: ReviewSourceType
  sourceRef: string | null
  /** JSON-serialized DiffFile[] snapshot, frozen at creation time (see ADR 0003). */
  snapshotData: string
  status: ReviewStatus
  createdAt: string
  updatedAt: string
}

export interface CreateReviewRequest {
  sourceType?: ReviewSourceType
  sourceRef?: string
  baseRef?: string
}

export interface UpdateReviewRequest {
  status?: ReviewStatus
}

export interface Comment {
  id: string
  reviewId: string
  filePath: string
  lineNumber: number | null
  lineType: DiffLineType | null
  content: string
  createdAt: string
  updatedAt: string
  resolved?: boolean
  suggestion?: string | null
}

export interface CreateCommentRequest {
  filePath: string
  lineNumber?: number | null
  lineType?: DiffLineType | null
  content: string
  suggestion?: string | null
}

export interface UpdateCommentRequest {
  content: string
}

export interface ApiError {
  error: string
  message: string
  statusCode: number
}
