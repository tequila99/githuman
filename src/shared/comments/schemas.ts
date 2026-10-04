import { Type } from '@sinclair/typebox'
import { Nullable } from '../utils/schemas.ts'
import { DiffLineTypeSchema } from '../diff/schemas.ts'

export const CommentSchema = Type.Object(
  {
    id: Type.String({ description: 'Comment id.' }),
    reviewId: Type.String({ description: 'Review that holds the comment.' }),
    filePath: Type.String({ description: 'Repository-relative file path.' }),
    lineNumber: Nullable(
      Type.Integer({
        description: 'First line of the comment. Null for a file comment.'
      })
    ),
    lineNumberEnd: Nullable(
      Type.Integer({
        description:
          'Last line of a selected range. Equals lineNumber for one line (ADR 0017).'
      })
    ),
    lineType: Nullable(DiffLineTypeSchema),
    content: Type.String({ description: 'Comment text in markdown.' }),
    createdAt: Type.String({ description: 'Creation time, ISO 8601.' }),
    updatedAt: Type.String({ description: 'Last change time, ISO 8601.' }),
    resolved: Type.Optional(
      Type.Boolean({ description: 'The comment is resolved.' })
    ),
    suggestion: Type.Optional(
      Nullable(
        Type.String({ description: 'Code that replaces the selected lines.' })
      )
    )
  },
  { description: 'A comment on a file or on lines of a review.' }
)

// Null goes first in each union: Fastify's Ajv coerces types, and with
// Integer (or String) first it turns a JSON null into 0 (or "") before the
// Null branch is ever tried — a file-level comment would be stored as line 0.
export const CreateCommentBody = Type.Object(
  {
    filePath: Type.String({
      minLength: 1,
      description: 'Repository-relative file path.'
    }),
    lineNumber: Type.Optional(
      Type.Union([Type.Null(), Type.Integer()], {
        description: 'First line. Null or omitted for a file comment.'
      })
    ),
    lineNumberEnd: Type.Optional(
      Type.Union([Type.Null(), Type.Integer()], {
        description: 'Last line of a range. Null or omitted for one line.'
      })
    ),
    lineType: Type.Optional(
      Type.Union([Type.Null(), ...DiffLineTypeSchema.anyOf], {
        description: 'Line kind of lineNumber. Null for a file comment.'
      })
    ),
    content: Type.String({ description: 'Comment text in markdown.' }),
    suggestion: Type.Optional(
      Type.Union([Type.Null(), Type.String()], {
        description: 'Code that replaces the selected lines.'
      })
    )
  },
  { description: 'A new comment.' }
)

export const UpdateCommentBody = Type.Object(
  {
    content: Type.String({ description: 'New comment text in markdown.' })
  },
  { description: 'A comment change.' }
)

export const CommentIdParams = Type.Object({
  id: Type.String({ description: 'Comment id.' })
})
