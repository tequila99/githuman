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
  ArtifactHistoricalChangeSetSchema,
  GraphIssueSchema,
  ArtifactSourceAnchorSchema
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
export type ArtifactHistoricalChangeSet = Static<
  typeof ArtifactHistoricalChangeSetSchema
>
export type GraphIssue = Static<typeof GraphIssueSchema>

export type ArtifactSourceAnchor = Static<typeof ArtifactSourceAnchorSchema>
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
export type ArtifactSearchInput = Static<
  typeof import('./schemas.ts').ArtifactSearchBody
>
export type ArtifactSearchItem = Static<
  typeof import('./schemas.ts').ArtifactSearchItemSchema
>
export type ArtifactSearchResult = Static<
  typeof import('./schemas.ts').ArtifactSearchSchema
>

export type ArtifactGraphEdge = Static<
  typeof import('./schemas.ts').ArtifactGraphEdgeSchema
>
export type ArtifactGraphPage = Static<
  typeof import('./schemas.ts').ArtifactGraphPageSchema
>
export type ArtifactAncestry = Static<
  typeof import('./schemas.ts').ArtifactAncestrySchema
>

export type ArtifactStoredChangeSet = Static<
  typeof import('./schemas.ts').ArtifactStoredChangeSetSchema
>
export type ArtifactValidationView = Static<
  typeof import('./schemas.ts').ArtifactValidationViewSchema
>
export type ArtifactReportChunk = Static<
  typeof import('./schemas.ts').ArtifactReportChunkSchema
>
export type PendingArtifactAction = Static<
  typeof import('./schemas.ts').PendingArtifactActionSchema
>
export type ArtifactActionInspection = Static<
  typeof import('./schemas.ts').ArtifactActionInspectionSchema
>
export type ArtifactActionList = Static<
  typeof import('./schemas.ts').ArtifactActionListSchema
>
export type ArtifactActionStatus = Static<
  typeof import('./schemas.ts').ArtifactActionStatusSchema
>

export type ArtifactValidationInspection = Static<
  typeof import('./schemas.ts').ArtifactValidationInspectionSchema
>
export type ArtifactChangeSetPreview = Static<
  typeof import('./schemas.ts').ArtifactChangeSetPreviewSchema
>

export type ArtifactExportEvent = Static<
  typeof import('./schemas.ts').ArtifactExportEventSchema
>
export type ArtifactMetadataExport = Static<
  typeof import('./schemas.ts').ArtifactMetadataExportSchema
>
export type ArtifactExportFormat = Static<
  typeof import('./schemas.ts').ArtifactExportQuery
>['format']
