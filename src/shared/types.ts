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
  /** `| undefined` (not just optional) because src/web's file-tree building
   *  code assigns `undefined` explicitly, which `exactOptionalPropertyTypes`
   *  (enabled for the web build only) treats as distinct from omitting it. */
  children?: FileTreeNode[] | undefined
}

export interface FileTreeResponse {
  ref: string
  files: string[]
}

/** Response shape of `GET /api/git/file/*` (see src/server/routes/git.ts). */
export interface FileContentResponse {
  path: string
  ref: string
  content: string
  lines: string[]
  lineCount: number
  isBinary: boolean
}

export type ReviewStatus = 'in_progress' | 'approved' | 'changes_requested'
/**
 * 'local' snapshots staged + unstaged diffs together — the only source type
 * the "Start review" UI offers, since a review's comments apply to both
 * regardless of which tab they were left on (see ADR 0018). 'staged'/
 * 'unstaged' remain valid API inputs (kept for API callers that want one
 * side only) but have no UI entry point anymore. 'branch'/'commits' are
 * unrelated future-MVP source types (ADR 0017), unaffected by this.
 */
export type ReviewSourceType =
  | 'local'
  | 'staged'
  | 'unstaged'
  | 'branch'
  | 'commits'

export interface Review {
  id: string
  repositoryPath: string
  baseRef: string | null
  sourceType: ReviewSourceType
  sourceRef: string | null
  /** JSON-serialized DiffFile[] snapshot, frozen at creation time (see ADR 0003). */
  snapshotData: string
  status: ReviewStatus
  /** User-provided or auto-generated ("source + date/time") name. Unique within `branch` (see ADR 0017). */
  name: string | null
  /** Git branch the repository was on when the review was created — a static snapshot, not recomputed (see ADR 0017). */
  branch: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateReviewRequest {
  sourceType?: ReviewSourceType
  sourceRef?: string
  baseRef?: string
  name?: string
}

export interface UpdateReviewRequest {
  status?: ReviewStatus
}

export interface Comment {
  id: string
  reviewId: string
  filePath: string
  lineNumber: number | null
  /** End of a drag-selected line range in the diff gutter; equal to `lineNumber` for a single line (see ADR 0017). */
  lineNumberEnd: number | null
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
  lineNumberEnd?: number | null
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
