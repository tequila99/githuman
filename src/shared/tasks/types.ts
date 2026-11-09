import type { Static } from '@sinclair/typebox'
import type {
  TaskSchema,
  TaskInputSchema,
  ArtifactTypeSchema,
  ArtifactTypeInputSchema,
  TaskChatLinkSchema,
  TaskLinkSchema
} from './schemas.ts'
export type Task = Static<typeof TaskSchema>
export type TaskLink = Static<typeof TaskLinkSchema>
export type TaskInput = Static<typeof TaskInputSchema>
export type ArtifactType = Static<typeof ArtifactTypeSchema>
export type ArtifactTypeInput = Static<typeof ArtifactTypeInputSchema>
export type TaskChatLink = Static<typeof TaskChatLinkSchema>

export type TaskList = Static<typeof import('./schemas.ts').TaskListSchema>
export type ArtifactTypeList = Static<
  typeof import('./schemas.ts').ArtifactTypeListSchema
>
export type TaskCreateRequest = Static<
  typeof import('./schemas.ts').TaskCreateBody
>
export type TaskUpdateRequest = Static<
  typeof import('./schemas.ts').TaskUpdateBody
>
export type ArtifactTypeCreateRequest = Static<
  typeof import('./schemas.ts').ArtifactTypeCreateBody
>
export type ArtifactTypeUpdateRequest = Static<
  typeof import('./schemas.ts').ArtifactTypeUpdateBody
>

export type SessionTaskAssignment = Static<
  typeof import('./schemas.ts').SessionTaskSchema
>
export type SessionTaskRequest = Static<
  typeof import('./schemas.ts').SessionTaskBody
>

export type TaskActivationRequest = Static<
  typeof import('./schemas.ts').TaskActivationBody
>
export type TaskCreateAndActivateRequest = Static<
  typeof import('./schemas.ts').TaskCreateAndActivateBody
>
export type TaskContext = Static<
  typeof import('./schemas.ts').TaskContextSchema
>
export type TaskActivationResult = Static<
  typeof import('./schemas.ts').TaskActivationResultSchema
>
export type TaskArtifact = Static<
  typeof import('./schemas.ts').TaskArtifactSchema
>
export type TaskArtifacts = Static<
  typeof import('./schemas.ts').TaskArtifactsSchema
>
