import { ForbiddenError } from '../../errors/http.ts'
import type { FastifyRequest } from 'fastify'

import { isLoopbackHost } from '../../../shared/network/loopback.ts'

function hostnameOf(hostWithPort: string): string {
  // "[::1]:3847" → "[::1]"; "localhost:3847" → "localhost"
  return hostWithPort.startsWith('[')
    ? hostWithPort.slice(0, hostWithPort.indexOf(']') + 1)
    : (hostWithPort.split(':')[0] ?? '')
}

/**
 * `onRequest` hook for the agent routes (ADR 0023). They are an RCE surface,
 * so besides only being registered on a loopback bind, each request must
 * prove it came from a page served by this very server: a loopback `Host`
 * (defeats DNS rebinding, where a hostile domain resolves to 127.0.0.1) and,
 * when the browser sends an `Origin`, one identical to that `Host`.
 * Non-browser clients (curl, tests) send no `Origin` and pass.
 */
export async function requireLocalOrigin(
  request: FastifyRequest
): Promise<void> {
  const host = request.headers.host ?? ''
  const origin = request.headers.origin
  let ok = isLoopbackHost(hostnameOf(host))
  if (ok && origin !== undefined) {
    try {
      ok = new URL(origin).host === host
    } catch {
      ok = false
    }
  }
  if (ok) {
    return
  }
  throw new ForbiddenError(
    `Agent endpoints only accept requests from this local server (Host: ${host || '-'}, Origin: ${origin ?? '-'}). Open the app via localhost.`
  )
}
