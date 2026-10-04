import { NotFoundError, BadRequestError } from '../errors/http.ts'
import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import {
  createReview,
  getReview,
  getReviews,
  setReviewStatus,
  removeReview
} from '../services/review.service.ts'
import { getRepositoryInfo } from '../services/git.service.ts'
import type { EventBus } from '../event-bus.ts'
import {
  CreateReviewBody,
  ReviewIdParams,
  ReviewSchema,
  ReviewSummarySchema,
  ReviewsQuery,
  UpdateReviewBody
} from '../../shared/reviews/schemas.ts'
import { ERROR_RESPONSES, NoContentSchema } from '../../shared/http/schemas.ts'

// OpenAPI group of these routes.
const TAGS = ['reviews']

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
    {
      schema: {
        tags: TAGS,
        summary: 'Create a review from the current diff',
        body: CreateReviewBody,
        response: {
          201: { ...ReviewSchema, description: 'The new review.' },
          ...ERROR_RESPONSES
        }
      }
    },
    async (request, reply) => {
      const review = await createReview(
        db,
        repositoryPath,
        request.body,
        eventBus
      )
      reply.code(201)
      return review
    }
  )

  typedApp.get(
    '/api/reviews',
    {
      schema: {
        tags: TAGS,
        summary: 'List reviews, newest first',
        querystring: ReviewsQuery,
        response: {
          200: Type.Array(ReviewSummarySchema, {
            description: 'Reviews without snapshots.'
          }),
          ...ERROR_RESPONSES
        }
      }
    },
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
    {
      schema: {
        tags: TAGS,
        summary: 'Get a review with its snapshot',
        params: ReviewIdParams,
        response: { 200: ReviewSchema, ...ERROR_RESPONSES }
      }
    },
    async request => {
      const review = getReview(db, request.params.id)

      if (!review) {
        throw new NotFoundError(`Review ${request.params.id} not found`)
      }

      return review
    }
  )

  typedApp.patch(
    '/api/reviews/:id',
    {
      schema: {
        tags: TAGS,
        summary: 'Change the review status',
        params: ReviewIdParams,
        body: UpdateReviewBody,
        response: {
          200: {
            ...ReviewSummarySchema,
            description: 'The changed review without its snapshot (#57).'
          },
          ...ERROR_RESPONSES
        }
      }
    },
    async request => {
      if (!request.body.status) {
        throw new BadRequestError('"status" is required')
      }

      const updated = setReviewStatus(
        db,
        request.params.id,
        request.body.status,
        eventBus
      )

      if (!updated) {
        throw new NotFoundError(`Review ${request.params.id} not found`)
      }

      return updated
    }
  )

  typedApp.delete(
    '/api/reviews/:id',
    {
      schema: {
        tags: TAGS,
        summary: 'Delete a review and its comments',
        params: ReviewIdParams,
        response: { 204: NoContentSchema, ...ERROR_RESPONSES }
      }
    },
    async (request, reply) => {
      if (!getReview(db, request.params.id)) {
        throw new NotFoundError(`Review ${request.params.id} not found`)
      }

      removeReview(db, request.params.id, eventBus)
      reply.code(204)
      return null
    }
  )
}
