import type { FastifyRequest } from 'fastify'
import type { ArtifactActor } from '../../shared/artifacts/types.ts'
import { ForbiddenError } from '../errors/http.ts'

export function artifactUserActor(request: FastifyRequest): ArtifactActor {
  if (
    !request.access ||
    (!request.access.local && request.access.device.status !== 'device')
  ) {
    throw new ForbiddenError('Authenticated user access is required.')
  }
  return {
    kind: 'user',
    id:
      request.access.device.status === 'device'
        ? request.access.device.device.id
        : 'local'
  }
}
