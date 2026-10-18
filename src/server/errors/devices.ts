import createError from '@fastify/error'

export const DeviceNotFoundError = createError<
  [message?: string, options?: ErrorOptions]
>('GHT_DEVICE_NOT_FOUND', '%s', 404)
export type DeviceNotFoundError = InstanceType<typeof DeviceNotFoundError>

/** The pairing request exists but its time is over. */
export const PairingExpiredError = createError<
  [message?: string, options?: ErrorOptions]
>('GHT_PAIRING_EXPIRED', '%s', 410)
export type PairingExpiredError = InstanceType<typeof PairingExpiredError>

/** The code does not match, or the device is already trusted. */
export const PairingConflictError = createError<
  [message?: string, options?: ErrorOptions]
>('GHT_PAIRING_CONFLICT', '%s', 409)
export type PairingConflictError = InstanceType<typeof PairingConflictError>

export const PairingRateLimitError = createError<
  [message?: string, options?: ErrorOptions]
>('GHT_PAIRING_RATE_LIMIT', '%s', 429)
export type PairingRateLimitError = InstanceType<typeof PairingRateLimitError>
