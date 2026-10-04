import type { Static } from '@sinclair/typebox'
import type {
  CreateReviewBody,
  ReviewExportSchema,
  ReviewSchema,
  ReviewSourceTypeSchema,
  ReviewStatusSchema,
  ReviewSummarySchema,
  UpdateReviewBody
} from './schemas.ts'

export type ReviewStatus = Static<typeof ReviewStatusSchema>

/** Meaning of each value: `ReviewSourceTypeSchema` in `./schemas.ts`. */
export type ReviewSourceType = Static<typeof ReviewSourceTypeSchema>

/** A review without its snapshot: what `GET /api/reviews` lists (#56). */
export type ReviewSummary = Static<typeof ReviewSummarySchema>

export type Review = Static<typeof ReviewSchema>

/** Body of `GET /api/reviews/:id/export?format=json`. */
export type ReviewExport = Static<typeof ReviewExportSchema>

export type CreateReviewRequest = Static<typeof CreateReviewBody>

export type UpdateReviewRequest = Static<typeof UpdateReviewBody>
