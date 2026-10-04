import type { Static } from '@sinclair/typebox'
import type {
  CommentSchema,
  CreateCommentBody,
  UpdateCommentBody
} from './schemas.ts'

export type Comment = Static<typeof CommentSchema>

export type CreateCommentRequest = Static<typeof CreateCommentBody>

export type UpdateCommentRequest = Static<typeof UpdateCommentBody>
