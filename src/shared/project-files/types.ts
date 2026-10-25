import type { Static } from '@sinclair/typebox'
import type {
  ProjectFileContextSchema,
  ProjectFileMetadataSchema
} from './schemas.ts'

export type ProjectFileMetadata = Static<typeof ProjectFileMetadataSchema>
export type ProjectFileContext = Static<typeof ProjectFileContextSchema>
