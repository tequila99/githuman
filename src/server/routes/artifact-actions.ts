import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { TSchema, Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import {
  ArtifactValidationInspectionSchema,
  ArtifactActionInspectionSchema,
  ArtifactActionListSchema,
  ArtifactStoredChangeSetSchema,
  ArtifactValidationViewSchema,
  ArtifactReportChunkSchema,
  ArtifactValidationReportQuery,
  ArtifactHistoryQuery,
  ArtifactParams,
  ArtifactChangeSetProposeBody,
  ArtifactValidationPrepareBody,
  ArtifactValidationStartBody,
  ArtifactLifecycleCommitBody,
  ArtifactAuthorizationRequestBody,
  ArtifactAuthorizationApproveBody,
  ArtifactLifecycleResultSchema
} from '../../shared/artifacts/schemas.ts'
import { DefinitionQuery } from '../../shared/tasks/schemas.ts'
import { ERROR_RESPONSES } from '../../shared/http/schemas.ts'
import { ArtifactInputError } from '../errors/artifacts.ts'
import { artifactUserActor } from '../utils/artifact-actor.ts'
import {
  artifactSessionId,
  type ArtifactLifecycleService
} from '../services/artifact-lifecycle.service.ts'

export async function artifactActionRoutes(
  app: FastifyInstance,
  options: {
    service: ArtifactLifecycleService
    recheckAccess: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>
  }
): Promise<void> {
  const { service } = options
  function post<T extends TSchema>(
    url: string,
    body: T,
    run: (
      request: FastifyRequest<{ Params: { id: string }; Body: Static<T> }>
    ) => unknown
  ) {
    app.post<{ Params: { id: string }; Body: Static<T> }>(
      url,
      {
        preHandler: options.recheckAccess,
        validatorCompiler:
          ({ httpPart }) =>
          data =>
            Value.Check(httpPart === 'params' ? ArtifactParams : body, data)
              ? { value: data }
              : { error: new ArtifactInputError('Invalid artifact action.') },
        schema: {
          tags: ['artifacts'],
          summary: 'Execute a structured artifact lifecycle action',
          ...(url.includes(':id') ? { params: ArtifactParams } : {}),
          body,
          response: { 200: ArtifactLifecycleResultSchema, ...ERROR_RESPONSES }
        }
      },
      run
    )
  }
  post('/api/artifact-change-sets', ArtifactChangeSetProposeBody, request =>
    service.propose(request.body, artifactUserActor(request))
  )
  post('/api/artifact-validations', ArtifactValidationPrepareBody, request =>
    service.jobs.get(
      service.prepare(request.body.changeSetId, request.body.version).id
    )
  )
  post(
    '/api/artifact-validations/:id/start',
    ArtifactValidationStartBody,
    request =>
      service.jobs.start(
        request.params.id,
        request.body.presetId,
        request.access?.device.status === 'device'
          ? request.access.device.device.id
          : undefined
      )
  )
  post(
    '/api/artifact-change-sets/:id/commit',
    ArtifactLifecycleCommitBody,
    request =>
      service.commit(
        request.params.id,
        request.body,
        artifactUserActor(request)
      )
  )
  post('/api/artifact-actions', ArtifactAuthorizationRequestBody, request =>
    service.authorization.request(
      request.body,
      artifactSessionId(artifactUserActor(request))
    )
  )
  post(
    '/api/artifact-actions/:id/approve',
    ArtifactAuthorizationApproveBody,
    request =>
      service.storage.catalog.transaction(() =>
        service.authorization.approve(request.params.id, request)
      )
  )
  app.get<{ Params: { id: string } }>(
    '/api/artifact-change-sets/:id',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read the current immutable proposal version',
        params: ArtifactParams,
        response: { 200: ArtifactStoredChangeSetSchema, ...ERROR_RESPONSES }
      }
    },
    request => service.get(request.params.id)
  )
  app.get<{ Params: { id: string } }>(
    '/api/artifact-validations/:id/check',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Inspect validation freshness and exact post-state',
        params: ArtifactParams,
        response: {
          200: ArtifactValidationInspectionSchema,
          ...ERROR_RESPONSES
        }
      }
    },
    request => service.inspectValidation(request.params.id)
  )
  app.get<{ Params: { id: string } }>(
    '/api/artifact-validations/:id',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read validation status and report summary',
        params: ArtifactParams,
        response: { 200: ArtifactValidationViewSchema, ...ERROR_RESPONSES }
      }
    },
    request => service.jobs.get(request.params.id)
  )
  app.get<{
    Params: { id: string }
    Querystring: Static<typeof DefinitionQuery>
  }>(
    '/api/artifact-validations/:id/manifest',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read a bounded manifest page',
        params: ArtifactParams,
        querystring: DefinitionQuery,
        response: { 200: ArtifactLifecycleResultSchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      service.jobs.manifest(
        request.params.id,
        request.query.limit,
        request.query.cursor
      )
  )
  app.get<{
    Params: { id: string }
    Querystring: Static<typeof ArtifactValidationReportQuery>
  }>(
    '/api/artifact-validations/:id/report',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read the complete structured report in bounded chunks',
        params: ArtifactParams,
        querystring: ArtifactValidationReportQuery,
        response: { 200: ArtifactReportChunkSchema, ...ERROR_RESPONSES }
      }
    },
    request => service.jobs.report(request.params.id, request.query.offset)
  )
  app.get<{
    Params: { id: string }
    Querystring: Static<typeof ArtifactHistoryQuery>
  }>(
    '/api/artifact-validations/:id/history',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read immutable validation state history',
        params: ArtifactParams,
        querystring: ArtifactHistoryQuery,
        response: { 200: ArtifactLifecycleResultSchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      service.jobs.history(
        request.params.id,
        request.query.afterSeq,
        request.query.limit
      )
  )
  app.get(
    '/api/artifact-actions',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read pending actions awaiting explicit user confirmation',
        response: { 200: ArtifactActionListSchema, ...ERROR_RESPONSES }
      }
    },
    () => ({
      storeId: service.storage.storeId,
      items: service.authorization.list()
    })
  )
  app.get<{ Params: { id: string } }>(
    '/api/artifact-actions/:id',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Inspect the exact pending or authorized action scope',
        params: ArtifactParams,
        response: { 200: ArtifactActionInspectionSchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      service.inspectAction(request.params.id, artifactUserActor(request))
  )
  app.delete<{ Params: { id: string } }>(
    '/api/artifact-actions/:id',
    {
      preHandler: options.recheckAccess,
      schema: {
        tags: ['artifacts'],
        summary: 'Revoke a pending action or authorization',
        params: ArtifactParams,
        response: { 200: ArtifactLifecycleResultSchema, ...ERROR_RESPONSES }
      }
    },
    request => {
      service.authorization.revoke(request.params.id)
      return { revoked: true }
    }
  )
  app.delete<{ Params: { id: string } }>(
    '/api/artifact-validations/:id',
    {
      preHandler: options.recheckAccess,
      schema: {
        tags: ['artifacts'],
        summary: 'Cancel a running validation job',
        params: ArtifactParams,
        response: { 200: ArtifactLifecycleResultSchema, ...ERROR_RESPONSES }
      }
    },
    request => {
      service.jobs.cancel(request.params.id)
      return service.jobs.get(request.params.id)
    }
  )
}
