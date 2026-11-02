import type { Static } from '@sinclair/typebox'
import type {
  ArtifactTransitionOperationListSchema,
  ArtifactTransitionOperationSchema,
  ArtifactTransitionOptionsSchema,
  ArtifactTransitionPreviewBody,
  ArtifactTransitionPreviewSchema,
  ArtifactTransitionStageSchema,
  ArtifactTransitionStartBody
} from './schemas.ts'

export type ArtifactTransitionStage = Static<
  typeof ArtifactTransitionStageSchema
>
export type ArtifactTransitionOptions = Static<
  typeof ArtifactTransitionOptionsSchema
>
export type ArtifactTransitionPreviewInput = Static<
  typeof ArtifactTransitionPreviewBody
>
export type ArtifactTransitionPreview = Static<
  typeof ArtifactTransitionPreviewSchema
>
export type ArtifactTransitionStartInput = Static<
  typeof ArtifactTransitionStartBody
>
export type ArtifactTransitionOperation = Static<
  typeof ArtifactTransitionOperationSchema
>
export type ArtifactTransitionOperationList = Static<
  typeof ArtifactTransitionOperationListSchema
>
