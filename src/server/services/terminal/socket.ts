import { TERMINAL_SNAPSHOT_BYTES } from '../../../shared/terminal/constants.ts'
import type { TerminalServerMessage } from '../../../shared/terminal/types.ts'
import { TerminalChannel } from './channel.ts'
import type { TerminalRegistry } from './registry.ts'

// Detect a dead peer: close the socket after one missed pong.
const HEARTBEAT_MS = 30_000

// The payload types that the `ws` package delivers to a message listener.
type RawData = Buffer | ArrayBuffer | Buffer[]

// The part of a `ws` socket that this module uses. A test can fake it.
export interface TerminalSocket {
  readonly readyState: number
  readonly OPEN: number
  readonly bufferedAmount: number
  send: (data: string, callback: (error?: Error) => void) => void
  ping: () => void
  terminate: () => void
  on: {
    (
      event: 'message',
      listener: (data: RawData, binary: boolean) => void
    ): unknown
    (event: 'pong' | 'close' | 'error', listener: () => void): unknown
  }
}

export interface TerminalSocketOptions {
  heartbeatMs?: number
  // Called once, when the socket closes or fails.
  onDisconnect?: () => void
}

function rawDataToText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return Buffer.concat(data).toString('utf8')
}

export function attachTerminalSocket(
  socket: TerminalSocket,
  registry: TerminalRegistry,
  options: TerminalSocketOptions = {}
): { close: () => void } {
  let alive = true
  // oxlint-disable-next-line prefer-const -- close captures the channel while its constructor sends the first message
  let channel: TerminalChannel | undefined
  const close = () => {
    channel?.dispose()
    socket.terminate()
  }
  const send = (message: TerminalServerMessage) => {
    if (socket.readyState !== socket.OPEN) return
    // A slow client must not make the server buffer without limit.
    if (socket.bufferedAmount > TERMINAL_SNAPSHOT_BYTES) {
      close()
      return
    }
    socket.send(JSON.stringify(message), error => {
      if (error) close()
    })
  }
  channel = new TerminalChannel(registry, send, close)
  socket.on('message', (data, binary) => {
    // The protocol uses text frames only.
    if (binary) {
      close()
      return
    }
    try {
      // The channel checks the shape of the message.
      channel?.receive(JSON.parse(rawDataToText(data)))
    } catch {
      close()
    }
  })
  socket.on('pong', () => {
    alive = true
  })
  const heartbeat = setInterval(() => {
    if (!alive) {
      close()
      return
    }
    // The next pong must arrive before the next tick.
    alive = false
    socket.ping()
  }, options.heartbeatMs ?? HEARTBEAT_MS)
  heartbeat.unref()
  let ended = false
  // Both `close` and `error` events call this function, so it must run only once.
  const cleanup = () => {
    if (ended) return
    ended = true
    clearInterval(heartbeat)
    channel?.dispose()
    options.onDisconnect?.()
  }
  socket.on('close', cleanup)
  socket.on('error', cleanup)
  return { close }
}
