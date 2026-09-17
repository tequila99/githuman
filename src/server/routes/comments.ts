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
  unresolveComment,
  ValidationError
} from '../services/comment.service.ts'
import type { EventBus } from '../event-bus.ts'

const CreateCommentBody = Type.Object({
  filePath: Type.String({ minLength: 1 }),
  lineNumber: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
  lineNumberEnd: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
  lineType: Type.Optional(
    Type.Union([
      Type.Literal('added'),
      Type.Literal('removed'),
      Type.Literal('context'),
      Type.Null()
    ])
  ),
  content: Type.String(),
  suggestion: Type.Optional(Type.Union([Type.String(), Type.Null()]))
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
        reply.code(404)
        return {
          error: 'Not Found',
          message: `Review ${request.params.id} not found`,
          statusCode: 404
        }
      }

      try {
        const comment = createComment(
          db,
          request.params.id,
          request.body,
          eventBus
        )
        reply.code(201)
        return comment
      } catch (error) {
        if (error instanceof ValidationError) {
          reply.code(400)
          return {
            error: 'Bad Request',
            message: error.message,
            statusCode: 400
          }
        }
        throw error
      }
    }
  )

  typedApp.get(
    '/api/reviews/:id/comments',
    { schema: { params: ReviewIdParams } },
    async (request, reply) => {
      if (!getReview(db, request.params.id)) {
        reply.code(404)
        return {
          error: 'Not Found',
          message: `Review ${request.params.id} not found`,
          statusCode: 404
        }
      }

      return getComments(db, request.params.id)
    }
  )

  typedApp.patch(
    '/api/comments/:id',
    { schema: { params: CommentIdParams, body: UpdateCommentBody } },
    async (request, reply) => {
      try {
        const updated = editComment(
          db,
          request.params.id,
          request.body.content,
          eventBus
        )

        if (!updated) {
          reply.code(404)
          return {
            error: 'Not Found',
            message: `Comment ${request.params.id} not found`,
            statusCode: 404
          }
        }

        return updated
      } catch (error) {
        if (error instanceof ValidationError) {
          reply.code(400)
          return {
            error: 'Bad Request',
            message: error.message,
            statusCode: 400
          }
        }
        throw error
      }
    }
  )

  typedApp.patch(
    '/api/comments/:id/resolve',
    { schema: { params: CommentIdParams } },
    async (request, reply) => {
      const updated = resolveComment(db, request.params.id, eventBus)

      if (!updated) {
        reply.code(404)
        return {
          error: 'Not Found',
          message: `Comment ${request.params.id} not found`,
          statusCode: 404
        }
      }

      return updated
    }
  )

  typedApp.patch(
    '/api/comments/:id/unresolve',
    { schema: { params: CommentIdParams } },
    async (request, reply) => {
      const updated = unresolveComment(db, request.params.id, eventBus)

      if (!updated) {
        reply.code(404)
        return {
          error: 'Not Found',
          message: `Comment ${request.params.id} not found`,
          statusCode: 404
        }
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
