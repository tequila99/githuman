import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyInstance } from 'fastify'
import { BadRequestError } from '../errors/http.ts'
import {
  clearDeviceCookie,
  deviceSecret,
  requireLocalRequest,
  setDeviceCookie
} from '../hooks/access/require-access.ts'
import type { DeviceRecord } from '../repositories/device.repo.ts'
import type { DeviceService } from '../services/device.service.ts'
import { machineAddresses } from '../utils/lan-addresses.ts'
import { clientAddress } from '../utils/request-origin.ts'
import {
  AccessSchema,
  ApproveDeviceBody,
  CreatePairingRequestBody,
  DeviceListSchema,
  DeviceParams,
  DeviceSchema,
  LanAddressesSchema,
  RenameDeviceBody
} from '../../shared/devices/schemas.ts'
import type { Access, Device } from '../../shared/devices/types.ts'
import { ERROR_RESPONSES, NoContentSchema } from '../../shared/http/schemas.ts'

// OpenAPI group of these routes.
const TAGS = ['devices']

export interface DeviceRoutesOptions {
  devices: DeviceService
  /** Tells the operator about a new request when no local tab is open. */
  onPairingRequest?: (device: Device) => void
}

// The secret hash and the pairing code never reach the operator's browser:
// the code is shown on the device only (ADR 0080).
function toDevice({
  secretHash: _secretHash,
  code: _code,
  ...device
}: DeviceRecord): Device {
  return device
}

function pendingAccess(device: DeviceRecord, now: number): Access {
  return {
    status: 'pending',
    pairing: {
      code: device.code,
      expiresAt: device.expiresAt,
      remainingMs: Math.max(0, Date.parse(device.expiresAt) - now)
    }
  }
}

export async function deviceRoutes(
  app: FastifyInstance,
  opts: DeviceRoutesOptions
): Promise<void> {
  const { devices, onPairingRequest } = opts
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.get(
    '/api/access',
    {
      schema: {
        tags: TAGS,
        summary: 'Access of this browser',
        response: { 200: AccessSchema, ...ERROR_RESPONSES }
      }
    },
    async (request, reply): Promise<Access> => {
      const access = request.access
      if (access?.local) return { status: 'local' }
      const device = access?.device ?? { status: 'none' as const }
      if (device.status === 'device') return { status: 'device' }
      if (device.status === 'pending') {
        return pendingAccess(device.device, devices.now())
      }
      // A stale secret blocks nothing, but a new request should start clean.
      if (deviceSecret(request, devices.serverId) !== undefined) {
        clearDeviceCookie(reply, devices.serverId)
      }
      return { status: 'none' }
    }
  )

  typedApp.post(
    '/api/devices/requests',
    {
      schema: {
        tags: TAGS,
        summary: 'Request access for this browser',
        body: CreatePairingRequestBody,
        response: { 200: AccessSchema, ...ERROR_RESPONSES }
      }
    },
    async (request, reply): Promise<Access> => {
      if (request.access?.local) {
        throw new BadRequestError('This machine needs no pairing.')
      }
      const { device, secret } = devices.createRequest({
        secret: deviceSecret(request, devices.serverId),
        ...(request.body.name === undefined ? {} : { name: request.body.name }),
        ...(request.headers['user-agent'] === undefined
          ? {}
          : { userAgent: request.headers['user-agent'] }),
        address: clientAddress(
          request.socket.remoteAddress,
          request.headers['x-forwarded-for']
        ),
        host: request.headers.host ?? ''
      })
      if (secret === undefined) return { status: 'device' }
      setDeviceCookie(reply, devices.serverId, secret)
      onPairingRequest?.(toDevice(device))
      return pendingAccess(device, devices.now())
    }
  )

  // Device management: only this machine may see, approve or revoke devices.
  app.register(async local => {
    local.addHook('onRequest', requireLocalRequest)
    const typedLocal = local.withTypeProvider<TypeBoxTypeProvider>()

    typedLocal.get(
      '/api/devices',
      {
        schema: {
          tags: TAGS,
          summary: 'List pending and trusted devices',
          response: { 200: DeviceListSchema, ...ERROR_RESPONSES }
        }
      },
      async () => devices.list().map(toDevice)
    )

    typedLocal.post(
      '/api/devices/:id/approve',
      {
        schema: {
          tags: TAGS,
          summary: 'Approve a pairing request',
          params: DeviceParams,
          body: ApproveDeviceBody,
          response: {
            200: { ...DeviceSchema, description: 'The trusted device.' },
            ...ERROR_RESPONSES
          }
        }
      },
      async request =>
        toDevice(devices.approve(request.params.id, request.body.code))
    )

    typedLocal.patch(
      '/api/devices/:id',
      {
        schema: {
          tags: TAGS,
          summary: 'Rename a device',
          params: DeviceParams,
          body: RenameDeviceBody,
          response: {
            200: { ...DeviceSchema, description: 'The renamed device.' },
            ...ERROR_RESPONSES
          }
        }
      },
      async request =>
        toDevice(devices.rename(request.params.id, request.body.name))
    )

    typedLocal.delete(
      '/api/devices/:id',
      {
        schema: {
          tags: TAGS,
          summary: 'Reject a pairing request or revoke a device',
          params: DeviceParams,
          response: { 204: NoContentSchema, ...ERROR_RESPONSES }
        }
      },
      async (request, reply) => {
        devices.revoke(request.params.id)
        reply.code(204)
        return null
      }
    )

    typedLocal.get(
      '/api/devices/lan-addresses',
      {
        schema: {
          tags: TAGS,
          summary: 'LAN addresses of this machine for a QR code',
          response: { 200: LanAddressesSchema, ...ERROR_RESPONSES }
        }
      },
      async () => machineAddresses()
    )
  })
}
