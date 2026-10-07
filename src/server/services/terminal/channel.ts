import { Value } from '@sinclair/typebox/value'
import { TerminalClientMessageSchema } from '../../../shared/terminal/schemas.ts'
import type { TerminalServerMessage } from '../../../shared/terminal/types.ts'
import { TERMINAL_CLIENT_BYTES } from '../../../shared/terminal/constants.ts'
import { errorMessage } from '../../../shared/utils/error-message.ts'
import { TerminalRegistry } from './registry.ts'

// Close the connection when a client queues more commands than it can need.
const MAX_PENDING_COMMANDS = 128
// Disconnect a client that stays blocked for this long.
const SLOW_CLIENT_MS = 5000
// Block the output of a session when a client holds this much unacknowledged data.
const CREDIT_PAUSE_BYTES = TERMINAL_CLIENT_BYTES / 16

interface Credit {
  bytes: number
  frames: Map<number, number>
  timeout?: ReturnType<typeof setTimeout>
  lastSequence: number
}
export class TerminalChannel {
  private readonly subscribed = new Set<string>()
  private readonly subscribing = new Set<string>()
  private readonly credit = new Map<string, Credit>()
  private readonly unsubscribe
  private stopped = false
  private commands = Promise.resolve()
  private pendingCommands = 0
  private readonly registry: TerminalRegistry
  private readonly send: (message: TerminalServerMessage) => void
  private readonly disconnect: () => void
  private readonly slowClientMs: number
  constructor(
    registry: TerminalRegistry,
    send: (message: TerminalServerMessage) => void,
    disconnect: () => void,
    slowClientMs = SLOW_CLIENT_MS
  ) {
    this.registry = registry
    this.send = send
    this.disconnect = disconnect
    this.slowClientMs = slowClientMs
    this.unsubscribe = registry.subscribe(message => this.event(message))
    send({ type: 'list', sessions: registry.list })
  }
  receive(value: unknown): void {
    if (!Value.Check(TerminalClientMessageSchema, value)) {
      this.disconnect()
      return
    }
    if (++this.pendingCommands > MAX_PENDING_COMMANDS) {
      this.disconnect()
      return
    }
    this.commands = this.commands
      .then(async () => {
        if (this.stopped) return undefined
        try {
          switch (value.type) {
            case 'create': {
              const session = await this.registry.create(value.cols, value.rows)
              if (!this.stopped)
                this.send({
                  type: 'created',
                  requestId: value.requestId,
                  terminalId: session.id
                })
              break
            }
            case 'subscribe':
              await this.attach(value.terminalId)
              break
            case 'snapshot':
              await this.snapshot(value.terminalId)
              break
            case 'input':
              this.registry.get(value.terminalId).write(value.data)
              break
            case 'line':
              this.registry.get(value.terminalId).line(value.data)
              break
            case 'signal':
              this.registry.get(value.terminalId).signal(value.signal)
              break
            case 'resize':
              await this.registry.resize(
                value.terminalId,
                value.cols,
                value.rows
              )
              break
            case 'close':
              await this.registry.close(value.terminalId)
              break
            case 'ack':
              this.ack(value.terminalId, value.sequence)
              break
            case 'ping':
              this.send({ type: 'pong' })
              break
          }
        } catch (error) {
          if (!this.stopped)
            this.send({
              type: 'error',
              ...('requestId' in value ? { requestId: value.requestId } : {}),
              code: 'GHT_TERMINAL',
              message: errorMessage(error)
            })
        }

        return undefined
      })
      .finally(() => {
        this.pendingCommands--
      })
  }
  private async attach(id: string): Promise<void> {
    if (this.subscribed.has(id) || this.subscribing.has(id)) return
    this.subscribing.add(id)
    try {
      this.registry.attach(id, this)
      await this.snapshot(id)
    } finally {
      this.subscribing.delete(id)
    }
  }
  private async snapshot(id: string): Promise<void> {
    const session = this.registry.get(id)
    await session.snapshot(message => {
      if (this.stopped) return undefined
      clearTimeout(this.credit.get(id)?.timeout)
      session.block(this, false)
      this.credit.set(id, {
        bytes: 0,
        frames: new Map(),
        lastSequence: message.type === 'snapshot' ? message.sequence : 0
      })
      this.subscribed.add(id)
      this.send(message)
      return undefined
    })
  }
  private ack(id: string, sequence: number): void {
    const credit = this.credit.get(id)
    if (!credit) return
    if (sequence > credit.lastSequence) {
      this.disconnect()
      return
    }
    for (const [key, bytes] of credit.frames)
      if (key <= sequence) {
        credit.bytes -= bytes
        credit.frames.delete(key)
      }
    this.flow(id, credit)
  }
  private flow(id: string, credit: Credit): void {
    if (credit.bytes > CREDIT_PAUSE_BYTES) {
      this.registry.get(id).block(this, true)
      credit.timeout ??= setTimeout(() => this.disconnect(), this.slowClientMs)
    } else {
      clearTimeout(credit.timeout)
      credit.timeout = undefined
      this.registry.get(id).block(this, false)
    }
  }

  private event(message: TerminalServerMessage): void {
    if (this.stopped) return undefined
    if (message.type === 'output') {
      if (!this.subscribed.has(message.terminalId)) return
      const credit = this.credit.get(message.terminalId)
      if (!credit) return
      const bytes = Buffer.byteLength(message.data)
      credit.bytes += bytes
      credit.frames.set(message.sequence, bytes)
      credit.lastSequence = message.sequence
      this.flow(message.terminalId, credit)
      if (credit.bytes > TERMINAL_CLIENT_BYTES) {
        this.disconnect()
        return
      }
    } else if (message.type === 'exit') {
      clearTimeout(this.credit.get(message.terminalId)?.timeout)
      this.subscribed.delete(message.terminalId)
      this.credit.delete(message.terminalId)
    }
    this.send(message)
  }
  dispose(): void {
    if (this.stopped) return undefined
    this.stopped = true
    for (const [id, credit] of this.credit) {
      clearTimeout(credit.timeout)
      try {
        this.registry.get(id).block(this, false)
      } catch {
        /* The session already exited. */
      }
    }
    this.unsubscribe()
    this.registry.detach(this)
    this.subscribed.clear()
    this.subscribing.clear()
    this.credit.clear()
  }
}
