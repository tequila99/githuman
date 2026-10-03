import type { DiffLineType } from '../diff/types.ts'

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
