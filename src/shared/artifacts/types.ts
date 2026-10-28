import type { Static } from '@sinclair/typebox'
import type {
  ArtifactActorSchema,
  ArtifactMetadataInputSchema,
  ArtifactSchema,
  ArtifactEventSchema,
  ArtifactListSchema,
  ArtifactHistorySchema,
  ArtifactContentSchema,
  ArtifactRelationSchema,
  ArtifactChangeSetSchema,
  GraphIssueSchema,
  ArtifactSourceAnchorSchema,
  ArtifactReviewScopeSchema,
  ArtifactReviewEventPayloadSchema,
  ArtifactReviewEventSchema,
  ArtifactReviewHistorySchema,
  ArtifactReviewCreateBody,
  ArtifactReviewCommentEventBody,
  ArtifactReviewDecisionBody,
  ArtifactReviewCommentSchema,
  ArtifactThreadCurrentSchema,
  ArtifactThreadViewSchema,
  ArtifactReviewStateSchema,
  ArtifactReviewListSchema,
  ArtifactReviewListQuery,
  ArtifactThreadSummarySchema,
  ArtifactReviewCommentPreviewSchema,
  ArtifactReviewCommentsSchema,
  ArtifactReviewCommentsQuery
} from './schemas.ts'

export type ArtifactActor = Static<typeof ArtifactActorSchema>
export type ArtifactMetadataInput = Static<typeof ArtifactMetadataInputSchema>
export type Artifact = Static<typeof ArtifactSchema>
export type ArtifactEvent = Static<typeof ArtifactEventSchema>
export type ArtifactList = Static<typeof ArtifactListSchema>
export type ArtifactHistory = Static<typeof ArtifactHistorySchema>
export type ArtifactContent = Static<typeof ArtifactContentSchema>

export type ArtifactRelation = Static<typeof ArtifactRelationSchema>
export type ArtifactChangeSet = Static<typeof ArtifactChangeSetSchema>
export type GraphIssue = Static<typeof GraphIssueSchema>

export type ArtifactSourceAnchor = Static<typeof ArtifactSourceAnchorSchema>
export type ArtifactReviewScope = Static<typeof ArtifactReviewScopeSchema>
export type ArtifactReviewEventPayload = Static<
  typeof ArtifactReviewEventPayloadSchema
>
export type ArtifactReviewEvent = Static<typeof ArtifactReviewEventSchema>
export type ArtifactReviewHistory = Static<typeof ArtifactReviewHistorySchema>

export type ArtifactReviewCreateInput = Static<typeof ArtifactReviewCreateBody>
export type ArtifactReviewCommentInput = Static<
  typeof ArtifactReviewCommentEventBody
>

export type ArtifactReviewDecisionInput = Static<
  typeof ArtifactReviewDecisionBody
>
export type ArtifactReviewComment = Static<typeof ArtifactReviewCommentSchema>
export type ArtifactThreadCurrent = Static<typeof ArtifactThreadCurrentSchema>
export type ArtifactThreadView = Static<typeof ArtifactThreadViewSchema>
export type ArtifactReviewState = Static<typeof ArtifactReviewStateSchema>
export type ArtifactReviewList = Static<typeof ArtifactReviewListSchema>
export type ArtifactReviewListOptions = Static<typeof ArtifactReviewListQuery>

export type ArtifactThreadSummary = Static<typeof ArtifactThreadSummarySchema>
export type ArtifactReviewCommentPreview = Static<
  typeof ArtifactReviewCommentPreviewSchema
>
export type ArtifactReviewComments = Static<typeof ArtifactReviewCommentsSchema>
export type ArtifactReviewCommentsOptions = Static<
  typeof ArtifactReviewCommentsQuery
>

export type ArtifactValidationReport = Static<
  typeof import('./schemas.ts').ArtifactValidationSubmitBody
>
export type ArtifactAuthorizationRequest = Static<
  typeof import('./schemas.ts').ArtifactAuthorizationRequestBody
>
export type ArtifactLifecycleCommit = Static<
  typeof import('./schemas.ts').ArtifactLifecycleCommitBody
>
export type ArtifactChangeSetProposal = Static<
  typeof import('./schemas.ts').ArtifactChangeSetProposeBody
>
