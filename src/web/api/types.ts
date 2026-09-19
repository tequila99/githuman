/**
 * Re-exported from src/shared/types.ts, the actual source of truth shared
 * with the backend — this file exists only so web code can import via
 * `@/api/types` instead of a relative path reaching out of src/web/.
 */
export type {
  RepositoryInfo,
  AppInfo,
  DiffFileStatus,
  DiffLineType,
  DiffLine,
  DiffHunk,
  DiffFile,
  FileTreeNode,
  FileTreeResponse,
  FileContentResponse,
  ApiError,
  ReviewStatus,
  ReviewSourceType,
  Review,
  CreateReviewRequest,
  UpdateReviewRequest,
  Comment,
  CreateCommentRequest,
  UpdateCommentRequest
} from '../../shared/types.ts'
