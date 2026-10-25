import type { Static } from '@sinclair/typebox'
import type { ProjectFileMetadataSchema } from './schemas.ts'

export type ProjectFileMetadata = Static<typeof ProjectFileMetadataSchema>
