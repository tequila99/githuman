import { Type } from '@sinclair/typebox'
import { MAX_ATTACHMENT_BYTES, MAX_FILE_SEARCH_LIMIT } from './constants.ts'

export const SessionParams = Type.Object({ id: Type.String() })
export const PermissionParams = Type.Object({
  id: Type.String(),
  requestId: Type.String()
})
export const CreateSessionBody = Type.Object({
  presetId: Type.String({ minLength: 1 }),
  name: Type.Optional(Type.String({ maxLength: 60 })),
  reviewId: Type.Optional(Type.String())
})
export const AutoApproveBody = Type.Object({ enabled: Type.Boolean() })
export const FileSearchQuery = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 200 })),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: MAX_FILE_SEARCH_LIMIT })
  )
})
export const ContextItem = Type.Union([
  Type.Object({
    kind: Type.Literal('diff'),
    source: Type.Union([Type.Literal('staged'), Type.Literal('unstaged')]),
    path: Type.Optional(Type.String({ minLength: 1 }))
  }),
  Type.Object({
    kind: Type.Literal('file'),
    path: Type.String({ minLength: 1 })
  }),
  Type.Object({ kind: Type.Literal('review'), reviewId: Type.String() }),
  Type.Object({
    kind: Type.Literal('attachment'),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    mimeType: Type.String({ maxLength: 255 }),
    data: Type.String({
      maxLength: Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4
    })
  })
])
export const PromptBody = Type.Object({
  text: Type.String({ minLength: 1 }),
  context: Type.Optional(Type.Array(ContextItem, { maxItems: 20 }))
})
export const PermissionBody = Type.Object({
  optionId: Type.Optional(Type.String())
})
export const ConfigBody = Type.Object({
  configId: Type.String({ minLength: 1 }),
  // No schema type on purpose: a Union/anyOf makes Fastify's Ajv coerce `true`
  // into the string "true", and a `type` array trips Ajv's strictTypes. The
  // session checks the value against the option the agent actually offered.
  value: Type.Unsafe<string | boolean>({})
})
