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

/** A review without its snapshot: what `GET /api/reviews` lists (#56). */
export interface ReviewSummary {
  id: string
  repositoryPath: string
  baseRef: string | null
  sourceType: ReviewSourceType
  sourceRef: string | null
  status: ReviewStatus
  /** User-provided or auto-generated ("source + date/time") name. Unique within `branch` (see ADR 0017). */
  name: string | null
  /** Git branch the repository was on when the review was created — a static snapshot, not recomputed (see ADR 0017). */
  branch: string | null
  createdAt: string
  updatedAt: string
}

export interface Review extends ReviewSummary {
  /** JSON-serialized DiffFile[] snapshot, frozen at creation time (see ADR 0003). */
  snapshotData: string
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
