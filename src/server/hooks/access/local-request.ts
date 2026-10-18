import type { FastifyRequest } from 'fastify'
import { isLoopbackHost } from '../../../shared/network/loopback.ts'
import {
  forwardedAddresses,
  isLoopbackAddress,
  parseHost,
  sameOrigin
} from '../../utils/request-origin.ts'

/**
 * True when the request comes from a page or a client on this machine
 * (ADR 0079). The `Host` header alone is not proof: with a bind on
 * `0.0.0.0` any client sends `Host: localhost`. A proxy on this machine
 * (the Quasar dev server, Tailscale Serve) connects from loopback, so a
 * non-loopback `X-Forwarded-For` entry also makes the request remote.
 * The loopback `Host` stays as the defence against DNS rebinding.
 */
export function isLocalRequest(request: FastifyRequest): boolean {
  const { host, origin } = request.headers
  const forwarded = forwardedAddresses(request.headers['x-forwarded-for'])
  const target = parseHost(host)
  return (
    isLoopbackAddress(request.socket.remoteAddress) &&
    forwarded !== undefined &&
    forwarded.every(isLoopbackAddress) &&
    target !== undefined &&
    isLoopbackHost(target.hostname) &&
    (origin === undefined || sameOrigin(origin, host))
  )
}
