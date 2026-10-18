import type { Static } from '@sinclair/typebox'
import type {
  AccessSchema,
  AccessStatusSchema,
  ApproveDeviceBody,
  CreatePairingRequestBody,
  DeviceSchema,
  DeviceStateSchema,
  RenameDeviceBody
} from './schemas.ts'

export type DeviceState = Static<typeof DeviceStateSchema>
export type Device = Static<typeof DeviceSchema>
export type AccessStatus = Static<typeof AccessStatusSchema>
export type Access = Static<typeof AccessSchema>
export type CreatePairingRequest = Static<typeof CreatePairingRequestBody>
export type ApproveDeviceRequest = Static<typeof ApproveDeviceBody>
export type RenameDeviceRequest = Static<typeof RenameDeviceBody>
