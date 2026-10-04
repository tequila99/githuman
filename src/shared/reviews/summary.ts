import type { Review, ReviewSummary } from './types.ts'

/** Drops the snapshot, so a list never holds a review's whole diff (#56). */
export function toReviewSummary(review: Review): ReviewSummary {
  const { snapshotData: _snapshot, ...summary } = review
  return summary
}
