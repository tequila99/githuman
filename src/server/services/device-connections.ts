import type { FastifyRequest } from 'fastify'
import type { DeviceService } from './device.service.ts'

/**
 * Open streams and sockets of trusted devices (ADR 0079, item 13). A revoke
 * in this process closes the connections in the same synchronous step.
 * A revoke by another process and an expiry close them at the next
 * `recheck`.
 *
 * Between the access hook and the registration of a stream there are
 * `await` steps, and the device can lose access in them. So `track` checks
 * the device again and adds the connection without an `await` between the
 * two: `node:sqlite` is synchronous, and JS runs one step at a time.
 */
export class DeviceConnections {
  private readonly byDevice = new Map<string, Set<() => void>>()
  private readonly devices: DeviceService

  constructor(devices: DeviceService) {
    this.devices = devices
    devices.onRemoved(id => this.closeDevice(id))
  }

  /**
   * Registers `close` for the device of this request. Returns the release
   * function for a normal close. Returns undefined when the device has no
   * access any more: then `close` was already called. A local request has
   * no device, so its release function does nothing.
   */
  track(request: FastifyRequest, close: () => void): (() => void) | undefined {
    const access = request.access
    if (!access || access.local) return () => {}
    const id =
      access.device.status === 'device' ? access.device.device.id : undefined
    if (id === undefined || !this.devices.isTrusted(id)) {
      close()
      return undefined
    }
    let closers = this.byDevice.get(id)
    if (!closers) {
      closers = new Set()
      this.byDevice.set(id, closers)
    }
    closers.add(close)
    return () => {
      closers.delete(close)
      if (closers.size === 0 && this.byDevice.get(id) === closers) {
        this.byDevice.delete(id)
      }
    }
  }

  /**
   * Closes the connections of devices that lost access without a call of
   * the local service: another server process on the same database revoked
   * them, or their time is over. The listener of the local service cannot
   * see such a change.
   */
  recheck(): void {
    // Deleting the current key during Map iteration is safe.
    for (const id of this.byDevice.keys()) {
      if (!this.devices.isTrusted(id)) this.closeDevice(id)
    }
  }

  /** Closes every connection of the device. A repeated call does nothing. */
  closeDevice(id: string): void {
    const closers = this.byDevice.get(id)
    if (!closers) return
    this.byDevice.delete(id)
    for (const close of closers) {
      try {
        close()
      } catch {
        // One broken connection must not keep the others open.
      }
    }
  }

  /** Number of open connections of the device; for tests. */
  count(id: string): number {
    return this.byDevice.get(id)?.size ?? 0
  }
}
