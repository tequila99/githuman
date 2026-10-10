interface SseMessage {
  id?: string
  event: string
  data: unknown
}

/** The part of `reply.sse` that `safeSend` needs. */
export interface SseSender {
  readonly isConnected: boolean
  send: (message: SseMessage) => Promise<void>
  onClose?: (callback: () => void) => void
}

interface SendQueue {
  messages: SseMessage[]
  sending: boolean
  closed: boolean
}

// Each connection must wait for backpressure before sending its next message.
const SEND_QUEUES = new WeakMap<SseSender, SendQueue>()

async function flush(sse: SseSender, queue: SendQueue): Promise<void> {
  queue.sending = true
  try {
    while (!queue.closed && sse.isConnected && queue.messages.length) {
      await sse.send(queue.messages.shift()!)
    }
  } catch {
    // A disconnected client must not cause an unhandled rejection.
  } finally {
    queue.messages.length = 0
    queue.sending = false
  }
}

/** Queue messages in order without concurrent writes to a slow client. */
export function safeSend(sse: SseSender, message: SseMessage): void {
  if (!sse.isConnected) return
  let queue = SEND_QUEUES.get(sse)
  if (!queue) {
    queue = { messages: [], sending: false, closed: false }
    SEND_QUEUES.set(sse, queue)
    const connectionQueue = queue
    sse.onClose?.(() => {
      connectionQueue.closed = true
      connectionQueue.messages.length = 0
    })
  }
  if (queue.closed) return
  queue.messages.push(message)
  if (!queue.sending) void flush(sse, queue)
}
