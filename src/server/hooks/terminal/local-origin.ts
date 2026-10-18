import type { FastifyRequest } from 'fastify'
import { ForbiddenError } from '../../errors/http.ts'
import { isLocalRequest } from '../access/local-request.ts'
import { isTrustedDeviceRequest } from '../access/require-access.ts'

// A browser always sends `Origin` on a WebSocket upgrade and a POST.
// Without it the token could not be bound to a page (ADR 0037).
export async function requireTerminalOrigin(
  request: FastifyRequest
): Promise<void> {
  const allowed =
    request.headers.origin !== undefined &&
    (isLocalRequest(request) || isTrustedDeviceRequest(request, true))
  if (!allowed) {
    throw new ForbiddenError(
      'Terminal endpoints only accept requests from this machine or a trusted device.'
    )
  }
}
