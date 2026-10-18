import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  DEVICE_IDLE_TTL_MS,
  DEVICE_TOUCH_INTERVAL_MS,
  MAX_PAIRING_REQUESTS_PER_MINUTE,
  MAX_PENDING_REQUESTS,
  PAIRING_CODE_LENGTH,
  PAIRING_REQUEST_INTERVAL_MS,
  PAIRING_REQUEST_TTL_MS
} from '../../shared/devices/constants.ts'
import { cleanDeviceName } from '../../shared/devices/name.ts'
import { toIsoString } from '../../shared/utils/date.ts'
import {
  DeviceNotFoundError,
  PairingConflictError,
  PairingExpiredError,
  PairingRateLimitError
} from '../errors/devices.ts'
import { BadRequestError } from '../errors/http.ts'
import {
  countPendingDevices,
  deleteDevice,
  ensureServerId,
  expiredDeviceIds,
  findDeviceById,
  findDeviceBySecretHash,
  insertDevice,
  listDevices,
  updateDevice,
  type DeviceRecord
} from '../repositories/device.repo.ts'
import { deviceNameFromUserAgent } from '../utils/device-name.ts'
import { addressKey } from '../utils/address-key.ts'
import { sha256Hex } from '../utils/hash.ts'

// Random bytes in a device secret: 256 bits, 43 base64url characters.
const SECRET_BYTES = 32
// A cookie value of another length is not a secret of this server.
const SECRET_LENGTH = 43
// Window of the global request limit.
const RATE_WINDOW_MS = 60 * 1000

export type DeviceAccess =
  | { status: 'none' }
  | { status: 'pending'; device: DeviceRecord }
  /** `renewed`: the idle deadline moved, so the cookie must move too. */
  | { status: 'device'; device: DeviceRecord; renewed: boolean }

export interface PairingInput {
  /** Secret from the cookie of this browser, if any. */
  secret?: string
  name?: string
  userAgent?: string
  address: string
  host: string
}

export interface DeviceServiceOptions {
  now?: () => number
  /** Called after any change of the device list. */
  onChange?: () => void
}

/**
 * Pairing requests and trusted devices (ADR 0079). The secret lives only in
 * the browser cookie; the database keeps its SHA-256. A random 256-bit
 * secret cannot be found from response times, so a lookup by the hash
 * index is safe without a constant-time compare.
 */
export class DeviceService {
  /** Random id in the cookie name: instances for other repositories keep their own cookie. */
  readonly serverId: string
  /** Clock of the service; routes use it for the time left of a request. */
  readonly now: () => number
  private readonly onChange: () => void
  private readonly lastRequestAt = new Map<string, number>()
  private recentRequests: number[] = []
  private readonly removeListeners = new Set<(id: string) => void>()
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync, options: DeviceServiceOptions = {}) {
    this.db = db
    this.now = options.now ?? Date.now
    this.onChange = options.onChange ?? (() => {})
    this.serverId = ensureServerId(db, () =>
      randomBytes(6).toString('base64url')
    )
  }

  /** Calls `listener` with the id of each removed device. Returns the unsubscribe function. */
  onRemoved(listener: (id: string) => void): () => void {
    this.removeListeners.add(listener)
    return () => this.removeListeners.delete(listener)
  }

  /**
   * Creates a pairing request. A browser that is already trusted gets its
   * device back and no new request. A new request from the same address
   * or with the same cookie replaces the old one.
   */
  createRequest(input: PairingInput): {
    device: DeviceRecord
    secret?: string
  } {
    const current = this.access(input.secret, input.address)
    if (current.status === 'device') {
      return { device: current.device }
    }
    this.removeExpiredPending()
    this.checkRate(addressKey(input.address))
    if (current.status === 'pending') {
      this.remove(current.device.id)
    }
    const key = addressKey(input.address)
    for (const device of listDevices(this.db)) {
      if (device.state === 'pending' && addressKey(device.address) === key) {
        this.remove(device.id)
      }
    }
    // A full list drops the oldest request: otherwise a few addresses could
    // keep every slot and lock the real device out.
    while (countPendingDevices(this.db) >= MAX_PENDING_REQUESTS) {
      const oldest = listDevices(this.db).find(
        device => device.state === 'pending'
      )
      if (!oldest) break
      this.remove(oldest.id)
    }

    const now = this.now()
    this.lastRequestAt.set(key, now)
    this.recentRequests.push(now)
    const secret = randomBytes(SECRET_BYTES).toString('base64url')
    const device: DeviceRecord = {
      id: randomUUID(),
      name:
        cleanDeviceName(input.name) || deviceNameFromUserAgent(input.userAgent),
      secretHash: sha256Hex(secret),
      state: 'pending',
      code: randomInt(0, 10 ** PAIRING_CODE_LENGTH)
        .toString()
        .padStart(PAIRING_CODE_LENGTH, '0'),
      host: input.host,
      address: input.address,
      createdAt: toIsoString(now),
      expiresAt: toIsoString(now + PAIRING_REQUEST_TTL_MS),
      lastSeenAt: toIsoString(now)
    }
    insertDevice(this.db, device)
    this.onChange()
    return { device, secret }
  }

  /**
   * Access of the browser with this cookie secret. An expired record never
   * gives access. A trusted device records activity at most once per
   * `DEVICE_TOUCH_INTERVAL_MS`.
   */
  access(secret: string | undefined, address?: string): DeviceAccess {
    if (secret?.length !== SECRET_LENGTH) return { status: 'none' }
    const device = findDeviceBySecretHash(this.db, sha256Hex(secret))
    const now = this.now()
    if (!device || Date.parse(device.expiresAt) <= now) {
      return { status: 'none' }
    }
    if (device.state === 'pending') {
      return { status: 'pending', device }
    }
    if (now - Date.parse(device.lastSeenAt) < DEVICE_TOUCH_INTERVAL_MS) {
      return { status: 'device', device, renewed: false }
    }
    const fields = {
      lastSeenAt: toIsoString(now),
      expiresAt: toIsoString(now + DEVICE_IDLE_TTL_MS),
      ...(address === undefined ? {} : { address })
    }
    updateDevice(this.db, device.id, fields)
    return { status: 'device', device: { ...device, ...fields }, renewed: true }
  }

  /** True when the device exists, is trusted and its time is not over. */
  isTrusted(id: string): boolean {
    const device = findDeviceById(this.db, id)
    return (
      device?.state === 'trusted' && Date.parse(device.expiresAt) > this.now()
    )
  }

  /**
   * Makes a pending request trusted. The code proves that the operator saw
   * this request: a replaced request has another id, and a matching id with
   * another code is a conflict.
   */
  approve(id: string, code: string): DeviceRecord {
    const device = findDeviceById(this.db, id)
    if (!device) {
      throw new DeviceNotFoundError(
        'The pairing request does not exist. It was replaced, rejected or removed.'
      )
    }
    if (device.state === 'trusted') {
      throw new PairingConflictError('The device is already trusted.')
    }
    const now = this.now()
    if (Date.parse(device.expiresAt) <= now) {
      throw new PairingExpiredError('The pairing request has expired.')
    }
    if (device.code !== code) {
      throw new PairingConflictError(
        'The code does not match the pairing request.'
      )
    }
    const fields = {
      state: 'trusted' as const,
      lastSeenAt: toIsoString(now),
      expiresAt: toIsoString(now + DEVICE_IDLE_TTL_MS)
    }
    updateDevice(this.db, id, fields)
    this.onChange()
    return { ...device, ...fields }
  }

  rename(id: string, name: string): DeviceRecord {
    const device = findDeviceById(this.db, id)
    if (!device) {
      throw new DeviceNotFoundError('The device does not exist.')
    }
    const trimmed = cleanDeviceName(name)
    if (!trimmed) {
      throw new BadRequestError('The device name is empty.')
    }
    updateDevice(this.db, id, { name: trimmed })
    this.onChange()
    return { ...device, name: trimmed }
  }

  /** Rejects a request or revokes a device. */
  revoke(id: string): void {
    if (!this.remove(id)) {
      throw new DeviceNotFoundError('The device does not exist.')
    }
  }

  /** Devices with time left. Expired pending requests are removed first. */
  list(): DeviceRecord[] {
    this.removeExpiredPending()
    const now = this.now()
    return listDevices(this.db).filter(
      device => Date.parse(device.expiresAt) > now
    )
  }

  /** Removes every expired record through the revoke path. Returns their ids. */
  removeExpired(): string[] {
    const ids = expiredDeviceIds(this.db, toIsoString(this.now()))
    for (const id of ids) this.remove(id)
    return ids
  }

  private removeExpiredPending(): void {
    for (const id of expiredDeviceIds(
      this.db,
      toIsoString(this.now()),
      'pending'
    )) {
      this.remove(id)
    }
  }

  /**
   * Deletes the record and tells listeners synchronously, so that open
   * connections close in the same step (ADR 0079, item 13). A repeated call
   * returns false and changes nothing.
   */
  private remove(id: string): boolean {
    if (!deleteDevice(this.db, id)) return false
    for (const listener of this.removeListeners) listener(id)
    this.onChange()
    return true
  }

  private checkRate(key: string): void {
    const now = this.now()
    const last = this.lastRequestAt.get(key)
    if (last !== undefined && now - last < PAIRING_REQUEST_INTERVAL_MS) {
      throw new PairingRateLimitError(
        'Pairing requests from this address are too frequent. Wait a few seconds.'
      )
    }
    this.recentRequests = this.recentRequests.filter(
      time => now - time < RATE_WINDOW_MS
    )
    if (this.recentRequests.length >= MAX_PAIRING_REQUESTS_PER_MINUTE) {
      throw new PairingRateLimitError(
        'Too many pairing requests. Try again in a minute.'
      )
    }
    for (const [storedKey, time] of this.lastRequestAt) {
      if (now - time >= PAIRING_REQUEST_INTERVAL_MS) {
        this.lastRequestAt.delete(storedKey)
      }
    }
  }
}
