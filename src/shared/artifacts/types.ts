import type { Static } from '@sinclair/typebox'
import type {
  ArtifactActorSchema,
  ArtifactMetadataInputSchema,
  ArtifactSchema,
  ArtifactEventSchema,
  ArtifactListSchema,
  ArtifactHistorySchema,
  ArtifactContentSchema
} from './schemas.ts'

export type ArtifactActor = Static<typeof ArtifactActorSchema>
export type ArtifactMetadataInput = Static<typeof ArtifactMetadataInputSchema>
export type Artifact = Static<typeof ArtifactSchema>
export type ArtifactEvent = Static<typeof ArtifactEventSchema>
export type ArtifactList = Static<typeof ArtifactListSchema>
export type ArtifactHistory = Static<typeof ArtifactHistorySchema>
export type ArtifactContent = Static<typeof ArtifactContentSchema>
