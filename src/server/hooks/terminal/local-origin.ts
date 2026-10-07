import type { FastifyRequest } from 'fastify'
import { isLoopbackHost } from '../../../shared/network/loopback.ts'
import { ForbiddenError } from '../../errors/http.ts'

// Returns false on any malformed value: an invalid URL means an invalid origin.
function isTerminalOrigin(host?: string, origin?: string): boolean {
  if (!host || !origin) return false
  try {
    const source = new URL(origin)
    const target = new URL(`http://${host}`)
    return (
      isLoopbackHost(target.hostname) &&
      target.host === host &&
      source.host === target.host &&
      source.protocol === 'http:' &&
      source.origin === origin &&
      !target.username &&
      !target.password
    )
  } catch {
    return false
  }
}

export async function requireTerminalOrigin(
  request: FastifyRequest
): Promise<void> {
  if (!isTerminalOrigin(request.headers.host, request.headers.origin))
    throw new ForbiddenError(
      'Terminal endpoints only accept requests from this local server. Open the app via localhost.'
    )
}
