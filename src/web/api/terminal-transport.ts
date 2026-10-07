import type {
  TerminalClientMessage,
  TerminalServerMessage
} from '../../shared/terminal/types.ts'
import { apiPost } from './client'
import { errorMessage } from '@/utils/error-message'

export type TerminalConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
export interface TerminalTransport {
  connect(): void
  send(message: TerminalClientMessage): boolean
  onMessage(listener: (message: TerminalServerMessage) => void): () => void
  onState(
    listener: (state: TerminalConnectionState, error?: string) => void
  ): () => void
  close(): void
}

export class WebSocketTerminalTransport implements TerminalTransport {
  private socket: WebSocket | null = null
  private stopped = false
  private generation = 0
  private retry: ReturnType<typeof setTimeout> | undefined
  private attempts = 0
  private readonly messages = new Set<
    (message: TerminalServerMessage) => void
  >()
  private readonly states = new Set<
    (state: TerminalConnectionState, error?: string) => void
  >()
  private readonly token: () => Promise<{ token: string }>
  private readonly socketFactory: (url: string) => WebSocket
  private readonly origin: () => string
  constructor(
    token = () => apiPost<{ token: string }>('/api/terminal/token'),
    socketFactory = (url: string) => new WebSocket(url),
    origin = () => window.location.origin
  ) {
    this.token = token
    this.socketFactory = socketFactory
    this.origin = origin
  }
  onMessage(listener: (message: TerminalServerMessage) => void): () => void {
    this.messages.add(listener)
    return () => this.messages.delete(listener)
  }
  onState(
    listener: (state: TerminalConnectionState, error?: string) => void
  ): () => void {
    this.states.add(listener)
    return () => this.states.delete(listener)
  }
  private state(state: TerminalConnectionState, error?: string): void {
    for (const listener of this.states) listener(state, error)
  }
  connect(): void {
    if (this.stopped || this.socket) return
    const generation = ++this.generation
    this.state('connecting')
    void this.token()
      .then(({ token }) => {
        if (this.stopped || generation !== this.generation) return undefined
        const url = new URL('/api/terminal/ws', this.origin())
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        url.searchParams.set('token', token)
        const socket = this.socketFactory(url.href)
        this.socket = socket
        socket.addEventListener('open', () => {
          this.attempts = 0
          this.state('connected')
        })
        socket.addEventListener('message', event => {
          try {
            // The server validates its protocol; this cast does not load TypeBox in the web bundle.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the local server owns this protocol
            const message = JSON.parse(
              String(event.data)
            ) as TerminalServerMessage
            for (const listener of this.messages) listener(message)
          } catch {
            socket.close()
          }
        })
        socket.addEventListener('close', () => {
          if (this.socket !== socket) return
          this.socket = null
          this.reconnect()
        })
        socket.addEventListener('error', () => {
          socket.close()
        })

        return undefined
      })
      .catch(error => {
        if (generation === this.generation) this.reconnect(errorMessage(error))
      })
  }
  private reconnect(error?: string): void {
    this.state('disconnected', error)
    if (this.stopped) return undefined
    clearTimeout(this.retry)
    this.retry = setTimeout(
      () => this.connect(),
      Math.min(10_000, 500 * 2 ** this.attempts++) + Math.random() * 250
    )
  }
  send(message: TerminalClientMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false
    if (this.socket.bufferedAmount > 128 * 1024) {
      this.socket.close()
      return false
    }
    this.socket.send(JSON.stringify(message))
    return true
  }
  close(): void {
    this.stopped = true
    this.generation++
    clearTimeout(this.retry)
    this.socket?.close()
    this.socket = null
    this.messages.clear()
    this.states.clear()
  }
}
