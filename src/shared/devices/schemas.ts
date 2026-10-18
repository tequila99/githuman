import { Type } from '@sinclair/typebox'
import { DEVICE_NAME_MAX_LENGTH, PAIRING_CODE_LENGTH } from './constants.ts'

export const DeviceStateSchema = Type.Union(
  [Type.Literal('pending'), Type.Literal('trusted')],
  {
    description:
      'pending: the device waits for the operator; trusted: the device has access.'
  }
)

const code = Type.String({
  pattern: `^\\d{${PAIRING_CODE_LENGTH}}$`,
  description: 'Code that the operator compares with the device screen.'
})

// The name reaches the server console: control characters could fake
// lines or send terminal escape sequences (C0, DEL and C1 ranges).
// Format characters (bidi overrides, zero-width) could fake the name.
const name = Type.String({
  minLength: 1,
  maxLength: DEVICE_NAME_MAX_LENGTH,
  pattern: '^[^\\p{Cc}\\p{Cf}]*$',
  description: 'Device name shown to the operator, without control characters.'
})

export const DeviceSchema = Type.Object(
  {
    id: Type.String({ description: 'Device id.' }),
    name,
    state: DeviceStateSchema,
    host: Type.String({
      description: 'Host header of the pairing request.'
    }),
    address: Type.String({
      description: 'Last client address of the device.'
    }),
    createdAt: Type.String({ description: 'ISO time of the pairing request.' }),
    expiresAt: Type.String({
      description:
        'ISO time when access ends: the request deadline, or 30 days after the last activity.'
    }),
    lastSeenAt: Type.String({
      description: 'ISO time of the last recorded activity.'
    })
  },
  { description: 'A device that requested or has access from the LAN.' }
)

export const DeviceListSchema = Type.Array(DeviceSchema, {
  description: 'Pending and trusted devices.'
})

export const AccessStatusSchema = Type.Union(
  [
    Type.Literal('local'),
    Type.Literal('device'),
    Type.Literal('pending'),
    Type.Literal('none')
  ],
  {
    description:
      'local: this machine; device: a trusted device; pending: a pairing request waits; none: no access.'
  }
)

export const AccessSchema = Type.Object(
  {
    status: AccessStatusSchema,
    pairing: Type.Optional(
      Type.Object(
        {
          code,
          expiresAt: Type.String({
            description: 'ISO time when the pairing request expires.'
          }),
          remainingMs: Type.Integer({
            minimum: 0,
            description:
              'Milliseconds until the request expires. The device clock can differ from the server clock.'
          })
        },
        { description: 'The pending pairing request of this browser.' }
      )
    )
  },
  { description: 'Access of the current browser.' }
)

export const CreatePairingRequestBody = Type.Object(
  { name: Type.Optional(name) },
  {
    description:
      'Pairing request. Without a name the server derives one from the User-Agent.'
  }
)

export const ApproveDeviceBody = Type.Object(
  { code },
  { description: 'Code that the operator saw on the device.' }
)

export const RenameDeviceBody = Type.Object(
  { name },
  { description: 'New device name.' }
)

export const DeviceParams = Type.Object(
  { id: Type.String({ description: 'Device id.' }) },
  { description: 'Device path parameters.' }
)

export const LanAddressesSchema = Type.Array(
  Type.String({ description: 'IP address of this machine in the LAN.' }),
  { description: 'Addresses that LAN devices can open.' }
)
