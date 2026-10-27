import type { Static } from '@sinclair/typebox'
import type {
  TaskSchema,
  TaskInputSchema,
  ArtifactTypeSchema,
  ArtifactTypeInputSchema,
  TaskChatLinkSchema
} from './schemas.ts'
export type Task = Static<typeof TaskSchema>
export type TaskInput = Static<typeof TaskInputSchema>
export type ArtifactType = Static<typeof ArtifactTypeSchema>
export type ArtifactTypeInput = Static<typeof ArtifactTypeInputSchema>
export type TaskChatLink = Static<typeof TaskChatLinkSchema>
