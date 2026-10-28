import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  FastifySchemaCompiler,
  FastifySchema
} from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Value } from '@sinclair/typebox/value'
import type { TSchema } from '@sinclair/typebox'
import {
  ArtifactParams,
  ArtifactReviewCreateBody,
  ArtifactReviewCommentEventBody,
  ArtifactReviewDecisionBody,
  ArtifactReviewEventSchema,
  ArtifactReviewListQuery,
  ArtifactReviewListSchema,
  ArtifactReviewStateSchema,
  ArtifactReviewHistorySchema,
  ArtifactHistoryQuery,
  ArtifactReviewCommentsQuery,
  ArtifactReviewCommentsSchema
} from '../../shared/artifacts/schemas.ts'
import { ARTIFACT_BRIDGE_BODY_LIMIT } from '../../shared/artifacts/mcp-constants.ts'
import { ERROR_RESPONSES } from '../../shared/http/schemas.ts'
import { artifactUserActor } from '../utils/artifact-actor.ts'
import { verifyReviewUserCommand } from '../services/artifact-review-user-command.ts'
import { ArtifactInputError } from '../errors/artifacts.ts'
import type { ArtifactReviewService } from '../services/artifact-review.service.ts'

function commandValidator(body: TSchema): FastifySchemaCompiler<FastifySchema> {
  // Ajv removes fields while trying union branches. Check these commands without mutation.
  return ({ httpPart }) =>
    (data: unknown) =>
      Value.Check(httpPart === 'params' ? ArtifactParams : body, data)
        ? { value: data }
        : { error: new ArtifactInputError('Invalid review command.') }
}

export async function artifactReviewRoutes(
  app: FastifyInstance,
  {
    service,
    recheckAccess
  }: {
    service: ArtifactReviewService
    recheckAccess: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>
  }
): Promise<void> {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>()
  typed.get(
    '/api/artifacts/:id/threads',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read inherited review threads and blockers',
        params: ArtifactParams,
        querystring: ArtifactReviewListQuery,
        response: { 200: ArtifactReviewListSchema, ...ERROR_RESPONSES }
      }
    },
    request => service.list(request.params.id, request.query)
  )
  typed.get(
    '/api/artifacts/:id/review-state',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read blockers, attention and validation epoch',
        params: ArtifactParams,
        response: { 200: ArtifactReviewStateSchema, ...ERROR_RESPONSES }
      }
    },
    request => service.summary(request.params.id)
  )
  typed.get(
    '/api/artifact-threads/:id/history',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read immutable review thread history',
        params: ArtifactParams,
        querystring: ArtifactHistoryQuery,
        response: { 200: ArtifactReviewHistorySchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      service.history(
        request.params.id,
        request.query.afterSeq,
        request.query.limit
      )
  )
  typed.get(
    '/api/artifact-threads/:id/comments',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read complete current comments by stable position',
        params: ArtifactParams,
        querystring: ArtifactReviewCommentsQuery,
        response: { 200: ArtifactReviewCommentsSchema, ...ERROR_RESPONSES }
      }
    },
    request => service.comments(request.params.id, request.query)
  )
  typed.post(
    '/api/artifacts/:id/threads',
    {
      bodyLimit: ARTIFACT_BRIDGE_BODY_LIMIT,
      preHandler: recheckAccess,
      validatorCompiler: commandValidator(ArtifactReviewCreateBody),
      schema: {
        tags: ['artifacts'],
        summary: 'Create an anchored or general review thread',
        params: ArtifactParams,
        body: ArtifactReviewCreateBody,
        response: { 200: ArtifactReviewEventSchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      service.createThread(
        request.params.id,
        request.body,
        artifactUserActor(request)
      )
  )
  typed.post(
    '/api/artifact-threads/:id/events',
    {
      preHandler: recheckAccess,
      validatorCompiler: commandValidator(ArtifactReviewCommentEventBody),
      schema: {
        tags: ['artifacts'],
        summary: 'Reply, edit or hide without changing resolution',
        params: ArtifactParams,
        body: ArtifactReviewCommentEventBody,
        response: { 200: ArtifactReviewEventSchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      service.comment(
        request.params.id,
        request.body,
        artifactUserActor(request)
      )
  )
  typed.post(
    '/api/artifact-threads/:id/decisions',
    {
      preHandler: recheckAccess,
      validatorCompiler: commandValidator(ArtifactReviewDecisionBody),
      schema: {
        tags: ['artifacts'],
        summary:
          'Execute a structured user review decision for an explicit scope',
        params: ArtifactParams,
        body: ArtifactReviewDecisionBody,
        response: { 200: ArtifactReviewEventSchema, ...ERROR_RESPONSES }
      }
    },
    request => service.decide(verifyReviewUserCommand(request))
  )
}
