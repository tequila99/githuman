import { Type } from '@sinclair/typebox'
import { Nullable } from '../utils/schemas.ts'
import { CommentSchema } from '../comments/schemas.ts'

export const ReviewStatusSchema = Type.Union(
  [
    Type.Literal('in_progress'),
    Type.Literal('approved'),
    Type.Literal('changes_requested')
  ],
  { description: 'Review state.' }
)

/**
 * 'local' snapshots staged + unstaged diffs together — the only source type
 * the "Start review" UI offers, since a review's comments apply to both
 * regardless of which tab they were left on (see ADR 0018). 'staged'/
 * 'unstaged' remain valid API inputs (kept for API callers that want one
 * side only) but have no UI entry point anymore. 'branch'/'commits' are
 * unrelated future-MVP source types (ADR 0017), unaffected by this.
 */
export const ReviewSourceTypeSchema = Type.Union(
  [
    Type.Literal('local'),
    Type.Literal('staged'),
    Type.Literal('unstaged'),
    Type.Literal('branch'),
    Type.Literal('commits')
  ],
  {
    description:
      'Diff in the snapshot: local (staged and unstaged), one side, a branch or commits.'
  }
)

const reviewSummaryFields = {
  id: Type.String({ description: 'Review id.' }),
  repositoryPath: Type.String({
    description: 'Absolute repository path at creation.'
  }),
  baseRef: Nullable(
    Type.String({
      description: 'Base ref for branch or commits reviews. Else null.'
    })
  ),
  sourceType: ReviewSourceTypeSchema,
  sourceRef: Nullable(
    Type.String({
      description:
        'Source ref for branch or commits reviews: a commit list for commits. Else null.'
    })
  ),
  status: ReviewStatusSchema,
  name: Nullable(
    Type.String({
      description:
        'User or generated name ("source + date/time"). Unique within branch (ADR 0017).'
    })
  ),
  branch: Nullable(
    Type.String({
      description:
        'Branch at creation. The server does not update it (ADR 0017).'
    })
  ),
  createdAt: Type.String({ description: 'Creation time, ISO 8601.' }),
  updatedAt: Type.String({ description: 'Last change time, ISO 8601.' })
}

export const ReviewSummarySchema = Type.Object(reviewSummaryFields, {
  description: 'A review without its snapshot (#56).'
})

export const ReviewSchema = Type.Object(
  {
    ...reviewSummaryFields,
    snapshotData: Type.String({
      description:
        'JSON array of DiffFile, frozen at creation (ADR 0003). The server does not parse it.'
    })
  },
  { description: 'A review with its diff snapshot.' }
)

export const ReviewExportSchema = Type.Object(
  {
    review: ReviewSchema,
    comments: Type.Array(CommentSchema, {
      description: 'All comments of the review.'
    })
  },
  { description: 'A review and its comments as JSON.' }
)

export const CreateReviewBody = Type.Object(
  {
    sourceType: Type.Optional(ReviewSourceTypeSchema),
    sourceRef: Type.Optional(
      Type.String({
        description:
          'Branch name for branch, or the newer ref ("to") for commits.'
      })
    ),
    baseRef: Type.Optional(
      Type.String({
        description:
          'Required for branch and commits: the base ref or the older ref ("from").'
      })
    ),
    name: Type.Optional(
      Type.String({
        description: 'Review name. Omitted or blank: the server makes one.'
      })
    )
  },
  { description: 'A new review. sourceType defaults to local.' }
)

export const ReviewsQuery = Type.Object({
  branch: Type.Optional(
    Type.String({ description: 'Branch filter. Default: current branch.' })
  ),
  search: Type.Optional(
    Type.String({
      description: 'Text to find in review names, case-insensitive.'
    })
  ),
  createdFrom: Type.Optional(
    Type.String({ description: 'Earliest creation time, ISO 8601.' })
  ),
  createdTo: Type.Optional(
    Type.String({ description: 'Latest creation time, ISO 8601.' })
  ),
  files: Type.Optional(
    Type.String({
      description:
        'Comma-separated file paths. A review matches if its snapshot has one of them.'
    })
  )
})

export const UpdateReviewBody = Type.Object(
  {
    status: Type.Optional(ReviewStatusSchema)
  },
  { description: 'A review change. status is required.' }
)

export const ReviewIdParams = Type.Object({
  id: Type.String({ description: 'Review id.' })
})

export const ExportQuery = Type.Object({
  format: Type.Union([Type.Literal('json'), Type.Literal('markdown')], {
    description: 'json gives the review and comments, markdown a report.'
  })
})
