import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import {
  createReview,
  getReview,
  getReviews,
  setReviewStatus,
  removeReview,
  ValidationError
} from '../services/review.service.ts'
import { getRepositoryInfo } from '../services/git.service.ts'
import type { EventBus } from '../event-bus.ts'

const CreateReviewBody = Type.Object({
  sourceType: Type.Optional(
    Type.Union([
      Type.Literal('local'),
      Type.Literal('staged'),
      Type.Literal('unstaged'),
      Type.Literal('branch'),
      Type.Literal('commits')
    ])
  ),
  sourceRef: Type.Optional(Type.String()),
  baseRef: Type.Optional(Type.String()),
  name: Type.Optional(Type.String())
})

const ReviewsQuery = Type.Object({
  branch: Type.Optional(Type.String()),
  search: Type.Optional(Type.String()),
  createdFrom: Type.Optional(Type.String()),
  createdTo: Type.Optional(Type.String()),
  /** Comma-separated file paths — reviews matching any of them are returned. */
  files: Type.Optional(Type.String())
})

const UpdateReviewBody = Type.Object({
  status: Type.Optional(
    Type.Union([
      Type.Literal('in_progress'),
      Type.Literal('approved'),
      Type.Literal('changes_requested')
    ])
  )
})

const ReviewIdParams = Type.Object({ id: Type.String() })

export interface ReviewRoutesOptions {
  repositoryPath: string
  db: DatabaseSync
  eventBus?: EventBus
}

export async function reviewRoutes(
  app: FastifyInstance,
  opts: ReviewRoutesOptions
): Promise<void> {
  const { repositoryPath, db, eventBus } = opts
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.post(
    '/api/reviews',
    { schema: { body: CreateReviewBody } },
    async (request, reply) => {
      try {
        const review = await createReview(
          db,
          repositoryPath,
          request.body,
          eventBus
        )
        reply.code(201)
        return review
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
    '/api/reviews',
    { schema: { querystring: ReviewsQuery } },
    async request => {
      const { branch, search, createdFrom, createdTo, files } = request.query
      const resolvedBranch =
        branch ?? (await getRepositoryInfo(repositoryPath)).branch

      return getReviews(db, {
        branch: resolvedBranch,
        search,
        createdFrom,
        createdTo,
        filePaths: files
          ? files.split(',').filter(path => path.length > 0)
          : undefined
      })
    }
  )

  typedApp.get(
    '/api/reviews/:id',
    { schema: { params: ReviewIdParams } },
    async (request, reply) => {
      const review = getReview(db, request.params.id)

      if (!review) {
        reply.code(404)
        return {
          error: 'Not Found',
          message: `Review ${request.params.id} not found`,
          statusCode: 404
        }
      }

      return review
    }
  )

  typedApp.patch(
    '/api/reviews/:id',
    { schema: { params: ReviewIdParams, body: UpdateReviewBody } },
    async (request, reply) => {
      if (!request.body.status) {
        reply.code(400)
        return {
          error: 'Bad Request',
          message: '"status" is required',
          statusCode: 400
        }
      }

      const updated = setReviewStatus(
        db,
        request.params.id,
        request.body.status,
        eventBus
      )

      if (!updated) {
        reply.code(404)
        return {
          error: 'Not Found',
          message: `Review ${request.params.id} not found`,
          statusCode: 404
        }
      }

      return updated
    }
  )

  typedApp.delete(
    '/api/reviews/:id',
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

      removeReview(db, request.params.id, eventBus)
      reply.code(204)
      return null
    }
  )
}
