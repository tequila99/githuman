import type { FastifyReply, FastifyRequest } from 'fastify'
import { DEVICE_IDLE_TTL_MS } from '../../../shared/devices/constants.ts'
import { ForbiddenError, UnauthorizedError } from '../../errors/http.ts'
import type {
  DeviceAccess,
  DeviceService
} from '../../services/device.service.ts'
import type { AllowedHosts } from '../../utils/allowed-hosts.ts'
import { clientAddress, sameOrigin } from '../../utils/request-origin.ts'
import { isLocalRequest } from './local-request.ts'

// Methods that do not change state; CSRF checks the others.
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])
// API routes that a browser without access needs to request pairing.
const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  'GET /api/access',
  'HEAD /api/access',
  'POST /api/devices/requests'
])

/** What the access hook found out about the request. */
export interface RequestAccess {
  local: boolean
  device: DeviceAccess
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the access hook for API requests; null for other requests. */
    access: RequestAccess | null
  }
}

export function deviceCookieName(serverId: string): string {
  return `ght_device_${serverId}`
}

/**
 * The cookie lives 30 days from the request or the last renewal. The
 * database decides if the secret still gives access (ADR 0079, item 8).
 * There is no `Secure` flag: the server speaks plain HTTP.
 */
export function setDeviceCookie(
  reply: FastifyReply,
  serverId: string,
  secret: string
): void {
  reply.setCookie(deviceCookieName(serverId), secret, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: DEVICE_IDLE_TTL_MS / 1000
  })
}

export function clearDeviceCookie(reply: FastifyReply, serverId: string): void {
  reply.clearCookie(deviceCookieName(serverId), { path: '/' })
}

export function deviceSecret(
  request: FastifyRequest,
  serverId: string
): string | undefined {
  return request.cookies[deviceCookieName(serverId)]
}

/**
 * Global `onRequest` hook (ADR 0079, item 9). It runs for every bind, and
 * decides by the matched route, not by `request.url`: Fastify finds
 * `/api/reviews` for `/%61pi/reviews`. Static files, `/health` and the SPA
 * fallback carry no data and pass.
 */
export function createAccessHook(options: {
  devices: DeviceService
  allowedHosts: AllowedHosts
}) {
  const { devices, allowedHosts } = options
  return async function requireAccess(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const route = request.routeOptions.url
    const api =
      request.url.startsWith('/api/') || route?.startsWith('/api/') === true
    if (!api) return
    reply.header('cache-control', 'no-store')

    const { host, origin } = request.headers
    const local = isLocalRequest(request)
    if (!local && !allowedHosts.allows(host)) {
      throw new ForbiddenError(
        `Unknown Host "${host ?? '-'}". Open the app by the IP address of this machine, or start the server with --allowed-host.`
      )
    }
    if (
      origin !== undefined &&
      !SAFE_METHODS.has(request.method) &&
      !sameOrigin(origin, host)
    ) {
      throw new ForbiddenError('The request Origin does not match the server.')
    }
    if (local) {
      request.access = { local: true, device: { status: 'none' } }
      return
    }

    const device = devices.access(
      deviceSecret(request, devices.serverId),
      clientAddress(
        request.socket.remoteAddress,
        request.headers['x-forwarded-for']
      )
    )
    request.access = { local: false, device }
    if (device.status === 'device' && device.renewed) {
      setDeviceCookie(
        reply,
        devices.serverId,
        deviceSecret(request, devices.serverId) ?? ''
      )
    }
    if (
      route !== undefined &&
      PUBLIC_ROUTES.has(`${request.method} ${route}`)
    ) {
      return
    }
    if (device.status !== 'device') {
      throw new UnauthorizedError(
        'This device has no access. Open the app to request access.'
      )
    }
  }
}

/**
 * True for a request of a trusted device that the access hook let through.
 * A browser sends no `Origin` on a same-origin GET or EventSource, so the
 * check needs `Origin` only when `originRequired` is set.
 */
export function isTrustedDeviceRequest(
  request: FastifyRequest,
  originRequired: boolean
): boolean {
  if (request.access?.device.status !== 'device') return false
  const { host, origin } = request.headers
  return origin === undefined ? !originRequired : sameOrigin(origin, host)
}

/** Route hook for device management: only this machine may approve or revoke. */
export async function requireLocalRequest(
  request: FastifyRequest
): Promise<void> {
  if (!isLocalRequest(request)) {
    throw new ForbiddenError(
      'Only this machine manages devices. Open the app via localhost.'
    )
  }
}
