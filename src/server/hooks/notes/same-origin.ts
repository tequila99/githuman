import type { FastifyRequest } from 'fastify'
import { isLoopbackHost } from '../../../shared/network/loopback.ts'
import { ForbiddenError } from '../../errors/http.ts'

// Returns false on any malformed value: an invalid URL means an invalid origin.
function isSameOrigin(host: string | undefined, origin: string): boolean {
  if (!host) return false
  try {
    return new URL(origin).host === new URL(`http://${host}`).host
  } catch {
    return false
  }
}

function isLoopbackRequestHost(host: string | undefined): boolean {
  if (!host) return false
  try {
    return isLoopbackHost(new URL(`http://${host}`).hostname)
  } catch {
    return false
  }
}

// A loopback bind also needs a loopback Host. A rebound hostile domain sends
// matching Origin and Host, so the match alone does not stop DNS rebinding.
// ADR 0008 allows LAN access without a password, so other binds skip this check.
export function createNotesOriginHook(options: { loopbackBind: boolean }) {
  return async function requireNotesOrigin(
    request: FastifyRequest
  ): Promise<void> {
    const { host, origin } = request.headers
    if (options.loopbackBind && !isLoopbackRequestHost(host)) {
      throw new ForbiddenError(
        'Notes only accept requests from this local server. Open the app via localhost.'
      )
    }
    if (origin && !isSameOrigin(host, origin)) {
      throw new ForbiddenError('Notes require the same origin as this server')
    }
  }
}
