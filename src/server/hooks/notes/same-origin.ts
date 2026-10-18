import type { FastifyRequest } from 'fastify'
import { ForbiddenError } from '../../errors/http.ts'
import { sameOrigin } from '../../utils/request-origin.ts'

// The global access hook decides who may read and write notes (ADR 0079).
// Notes also reject a foreign Origin on reads, unlike other routes.
export async function requireNotesOrigin(
  request: FastifyRequest
): Promise<void> {
  const { host, origin } = request.headers
  if (origin && !sameOrigin(origin, host)) {
    throw new ForbiddenError('Notes require the same origin as this server')
  }
}
