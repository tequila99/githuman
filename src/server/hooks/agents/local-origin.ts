import { ForbiddenError } from '../../errors/http.ts'
import type { FastifyRequest } from 'fastify'

import { isLocalRequest } from '../access/local-request.ts'
import { isTrustedDeviceRequest } from '../access/require-access.ts'

/**
 * `onRequest` hook for the agent routes (ADR 0023, ADR 0079). They are an
 * RCE surface, so each request must come from this machine (see
 * `isLocalRequest`) or from a trusted device. Non-browser clients (curl,
 * tests) send no `Origin` and pass.
 */
export async function requireLocalOrigin(
  request: FastifyRequest
): Promise<void> {
  if (isLocalRequest(request) || isTrustedDeviceRequest(request, false)) {
    return
  }
  const { host, origin } = request.headers
  throw new ForbiddenError(
    `Agent endpoints only accept requests from this machine or a trusted device (Host: ${host || '-'}, Origin: ${origin ?? '-'}).`
  )
}
