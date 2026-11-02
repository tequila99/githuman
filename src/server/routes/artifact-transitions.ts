import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ERROR_RESPONSES } from '../../shared/http/schemas.ts'
import { ArtifactParams } from '../../shared/artifacts/schemas.ts'
import {
  ArtifactTransitionOperationListSchema,
  ArtifactTransitionOperationSchema,
  ArtifactTransitionOptionsSchema,
  ArtifactTransitionParams,
  ArtifactTransitionPreviewBody,
  ArtifactTransitionPreviewSchema,
  ArtifactTransitionStartBody
} from '../../shared/artifact-transitions/schemas.ts'
import type {
  ArtifactTransitionPreviewInput,
  ArtifactTransitionStartInput
} from '../../shared/artifact-transitions/types.ts'
import { artifactUserActor } from '../utils/artifact-actor.ts'
import type { ArtifactTransitionService } from '../services/artifact-transition.service.ts'

/** Status-change routes of ADR 0107; they accept only user access, never an agent key. */
export async function artifactTransitionRoutes(
  app: FastifyInstance,
  options: {
    service: ArtifactTransitionService
    recheckAccess: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>
  }
): Promise<void> {
  const { service } = options
  app.get<{ Params: { id: string } }>(
    '/api/artifacts/:id/transitions',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'List the statuses a user can choose for an artifact',
        params: ArtifactParams,
        response: { 200: ArtifactTransitionOptionsSchema, ...ERROR_RESPONSES }
      }
    },
    request => service.options(request.params.id)
  )
  app.post<{ Params: { id: string }; Body: ArtifactTransitionPreviewInput }>(
    '/api/artifacts/:id/transition-previews',
    {
      preHandler: options.recheckAccess,
      schema: {
        tags: ['artifacts'],
        summary: 'Preview the exact consequences of a status change',
        params: ArtifactParams,
        body: ArtifactTransitionPreviewBody,
        response: {
          200: ArtifactTransitionPreviewSchema,
          ...ERROR_RESPONSES
        }
      }
    },
    request =>
      service.preview(
        request.params.id,
        request.body.targetStatus,
        artifactUserActor(request)
      )
  )
  app.get<{ Params: { id: string } }>(
    '/api/artifacts/:id/transition-operations',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'List recent status-change operations of an artifact',
        params: ArtifactParams,
        response: {
          200: ArtifactTransitionOperationListSchema,
          ...ERROR_RESPONSES
        }
      }
    },
    request => service.list(request.params.id)
  )
  app.post<{ Body: ArtifactTransitionStartInput }>(
    '/api/artifact-transition-operations',
    {
      preHandler: options.recheckAccess,
      schema: {
        tags: ['artifacts'],
        summary: 'Confirm a previewed status change and start the operation',
        body: ArtifactTransitionStartBody,
        response: {
          200: ArtifactTransitionOperationSchema,
          ...ERROR_RESPONSES
        }
      }
    },
    request =>
      service.begin(
        request.body,
        artifactUserActor(request),
        request.access?.device.status === 'device'
          ? request.access.device.device.id
          : undefined
      )
  )
  app.get<{ Params: { id: string } }>(
    '/api/artifact-transition-operations/:id',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read a status-change operation',
        params: ArtifactTransitionParams,
        response: {
          200: ArtifactTransitionOperationSchema,
          ...ERROR_RESPONSES
        }
      }
    },
    request => service.operation(request.params.id)
  )
  app.post<{ Params: { id: string } }>(
    '/api/artifact-transition-operations/:id/cancel',
    {
      preHandler: options.recheckAccess,
      schema: {
        tags: ['artifacts'],
        summary: 'Request cancellation before the change is applied',
        params: ArtifactTransitionParams,
        response: {
          200: ArtifactTransitionOperationSchema,
          ...ERROR_RESPONSES
        }
      }
    },
    request => {
      artifactUserActor(request)
      return service.cancel(request.params.id)
    }
  )
}
