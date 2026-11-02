import type { Readable, Writable } from 'node:stream'
import { isRecord } from '../../../shared/utils/guards.ts'

// Large artifact pages can expand when escaped as JSON.
export const MAX_CONTROL_BYTES = 16 * 1024 * 1024
// Bound permissions and outstanding RPC calls for one session.
export const MAX_PENDING_CALLS = 64
// Startup must not leave a partial context alive indefinitely.
export const BRIDGE_TIMEOUT_MS = 30000
// Version both peers together when the control contract changes.
export const CONTROL_VERSION = 1

export interface ControlFrame {
  type: string
  nonce: string
  version: number
  [key: string]: unknown
}

export class JsonChannel {
  #buffer = Buffer.alloc(0)
  #closed = false
  readonly input: Readable
  readonly output: Writable
  readonly failed: () => void
  constructor(
    input: Readable,
    output: Writable,
    receive: (frame: ControlFrame) => void,
    failed: () => void
  ) {
    this.input = input
    this.output = output
    this.failed = failed
    input.on('data', (chunk: Buffer) => {
      if (this.#closed) return
      if (this.#buffer.length + chunk.length > MAX_CONTROL_BYTES) {
        return this.close(true)
      }
      this.#buffer = Buffer.concat([this.#buffer, chunk])
      let index: number
      while ((index = this.#buffer.indexOf(10)) >= 0) {
        const line = this.#buffer.subarray(0, index)
        this.#buffer = this.#buffer.subarray(index + 1)
        try {
          const frame: unknown = JSON.parse(line.toString())
          if (
            !isRecord(frame) ||
            typeof frame.type !== 'string' ||
            typeof frame.nonce !== 'string' ||
            frame.version !== CONTROL_VERSION
          ) {
            throw new Error('Invalid control frame')
          }
          receive({
            ...frame,
            type: frame.type,
            nonce: frame.nonce,
            version: CONTROL_VERSION
          })
        } catch {
          this.close(true)
          return
        }
      }
    })
    input.on('end', () => this.close(true))
    input.on('error', () => this.close(true))
    output.on('error', () => this.close(true))
  }
  send(frame: ControlFrame): void {
    if (this.#closed) throw new Error('Pi control channel is closed')
    const line = JSON.stringify(frame) + '\n'
    if (
      Buffer.byteLength(line) > MAX_CONTROL_BYTES ||
      this.output.writableLength > MAX_CONTROL_BYTES
    ) {
      throw new Error('Pi control output exceeds the limit')
    }
    this.output.write(line)
  }
  close(failure = false): void {
    if (this.#closed) return
    this.#closed = true
    this.#buffer = Buffer.alloc(0)
    this.input.destroy()
    this.output.destroy()
    if (failure) this.failed()
  }
}
