import { NotFoundError } from '../errors/http.ts'
import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { getReview } from '../services/review.service.ts'
import {
  createComment,
  getComments,
  editComment,
  removeComment,
  resolveComment,
  unresolveComment
} from '../services/comment.service.ts'
import type { EventBus } from '../event-bus.ts'

// Null goes first in each union: Fastify's Ajv coerces types, and with
// Integer (or String) first it turns a JSON null into 0 (or "") before the
// Null branch is ever tried — a file-level comment would be stored as line 0.
const CreateCommentBody = Type.Object({
  filePath: Type.String({ minLength: 1 }),
  lineNumber: Type.Optional(Type.Union([Type.Null(), Type.Integer()])),
  lineNumberEnd: Type.Optional(Type.Union([Type.Null(), Type.Integer()])),
  lineType: Type.Optional(
    Type.Union([
      Type.Null(),
      Type.Literal('added'),
      Type.Literal('removed'),
      Type.Literal('context')
    ])
  ),
  content: Type.String(),
  suggestion: Type.Optional(Type.Union([Type.Null(), Type.String()]))
})

const UpdateCommentBody = Type.Object({
  content: Type.String()
})

const ReviewIdParams = Type.Object({ id: Type.String() })
const CommentIdParams = Type.Object({ id: Type.String() })

export interface CommentRoutesOptions {
  db: DatabaseSync
  eventBus?: EventBus
}

export async function commentRoutes(
  app: FastifyInstance,
  opts: CommentRoutesOptions
): Promise<void> {
  const { db, eventBus } = opts
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.post(
    '/api/reviews/:id/comments',
    { schema: { params: ReviewIdParams, body: CreateCommentBody } },
    async (request, reply) => {
      if (!getReview(db, request.params.id)) {
        throw new NotFoundError(`Review ${request.params.id} not found`)
      }

      const comment = createComment(
        db,
        request.params.id,
        request.body,
        eventBus
      )
      reply.code(201)
      return comment
    }
  )

  typedApp.get(
    '/api/reviews/:id/comments',
    { schema: { params: ReviewIdParams } },
    async request => {
      if (!getReview(db, request.params.id)) {
        throw new NotFoundError(`Review ${request.params.id} not found`)
      }

      return getComments(db, request.params.id)
    }
  )

  typedApp.patch(
    '/api/comments/:id',
    { schema: { params: CommentIdParams, body: UpdateCommentBody } },
    async request => {
      const updated = editComment(
        db,
        request.params.id,
        request.body.content,
        eventBus
      )

      if (!updated) {
        throw new NotFoundError(`Comment ${request.params.id} not found`)
      }

      return updated
    }
  )

  typedApp.patch(
    '/api/comments/:id/resolve',
    { schema: { params: CommentIdParams } },
    async request => {
      const updated = resolveComment(db, request.params.id, eventBus)

      if (!updated) {
        throw new NotFoundError(`Comment ${request.params.id} not found`)
      }

      return updated
    }
  )

  typedApp.patch(
    '/api/comments/:id/unresolve',
    { schema: { params: CommentIdParams } },
    async request => {
      const updated = unresolveComment(db, request.params.id, eventBus)

      if (!updated) {
        throw new NotFoundError(`Comment ${request.params.id} not found`)
      }

      return updated
    }
  )

  typedApp.delete(
    '/api/comments/:id',
    { schema: { params: CommentIdParams } },
    async (request, reply) => {
      removeComment(db, request.params.id, eventBus)
      reply.code(204)
    }
  )
}
