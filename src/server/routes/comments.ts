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
import {
  CommentIdParams,
  CommentSchema,
  CreateCommentBody,
  UpdateCommentBody
} from '../../shared/comments/schemas.ts'
import { ReviewIdParams } from '../../shared/reviews/schemas.ts'
import { ERROR_RESPONSES, NoContentSchema } from '../../shared/http/schemas.ts'

// OpenAPI group of these routes.
const TAGS = ['comments']

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
    {
      schema: {
        tags: TAGS,
        summary: 'Add a comment to a review',
        params: ReviewIdParams,
        body: CreateCommentBody,
        response: {
          201: { ...CommentSchema, description: 'The new comment.' },
          ...ERROR_RESPONSES
        }
      }
    },
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
    {
      schema: {
        tags: TAGS,
        summary: 'List comments of a review',
        params: ReviewIdParams,
        response: {
          200: Type.Array(CommentSchema, {
            description: 'Comments of the review.'
          }),
          ...ERROR_RESPONSES
        }
      }
    },
    async request => {
      if (!getReview(db, request.params.id)) {
        throw new NotFoundError(`Review ${request.params.id} not found`)
      }

      return getComments(db, request.params.id)
    }
  )

  typedApp.patch(
    '/api/comments/:id',
    {
      schema: {
        tags: TAGS,
        summary: 'Change the comment text',
        params: CommentIdParams,
        body: UpdateCommentBody,
        response: {
          200: { ...CommentSchema, description: 'The changed comment.' },
          ...ERROR_RESPONSES
        }
      }
    },
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
    {
      schema: {
        tags: TAGS,
        summary: 'Mark a comment as resolved',
        params: CommentIdParams,
        response: {
          200: { ...CommentSchema, description: 'The changed comment.' },
          ...ERROR_RESPONSES
        }
      }
    },
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
    {
      schema: {
        tags: TAGS,
        summary: 'Mark a comment as not resolved',
        params: CommentIdParams,
        response: {
          200: { ...CommentSchema, description: 'The changed comment.' },
          ...ERROR_RESPONSES
        }
      }
    },
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
    {
      schema: {
        tags: TAGS,
        summary: 'Delete a comment',
        description: 'A missing comment also gives 204.',
        params: CommentIdParams,
        response: { 204: NoContentSchema, ...ERROR_RESPONSES }
      }
    },
    async (request, reply) => {
      removeComment(db, request.params.id, eventBus)
      reply.code(204)
    }
  )
}
