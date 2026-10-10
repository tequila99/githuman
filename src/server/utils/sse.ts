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
  close: () => void
}

interface SendQueue {
  messages: SseMessage[]
  sending: boolean
  closed: boolean
  /** `Date.now()` when the current send started. */
  sendStartedAt: number
}

// Each connection must wait for backpressure before sending its next message.
const SEND_QUEUES = new WeakMap<SseSender, SendQueue>()

/**
 * The maximum number of messages in the send queue of one connection. On a
 * reconnect the agent stream replays every session buffer at once:
 * MAX_AGENT_SESSIONS × MAX_BUFFERED_EVENTS, plus a `gap` and a `state` for
 * each session. A lower limit closes the stream before its first send, and the
 * client then reconnects in a loop. The limit is about twice that replay, so
 * live events have room. This count bounds memory. There is no byte limit:
 * most queued items point to events that the session buffers hold already (#85).
 */
export const MAX_QUEUED_MESSAGES = 50_000

/**
 * A send that has not finished after this time means that the client stopped
 * reading. The check runs when a new message arrives, so it closes a dead
 * connection before the count limit does. A slow client that still reads
 * finishes each send sooner. The
 * check uses `Date.now()`: a jump of the system clock can make a false stall,
 * and the client then only reconnects.
 */
export const STALL_TIMEOUT_MS = 30_000

/**
 * Closes a connection that does not read, and drops its queue. Dropping only
 * some messages would hide the loss from the client. The client reconnects by
 * itself: the agent stream resumes from `Last-Event-ID` or gets `gap`, and
 * `/api/events` refetches after the reconnect. Nothing is logged: the Fastify
 * logger is off, and the reconnect is the normal recovery (#85).
 */
function dropConnection(sse: SseSender, queue: SendQueue): void {
  if (queue.closed) return
  queue.closed = true
  queue.messages.length = 0
  try {
    sse.close()
  } catch {
    // The connection is already gone.
  }
}

async function flush(sse: SseSender, queue: SendQueue): Promise<void> {
  queue.sending = true
  try {
    while (!queue.closed && sse.isConnected && queue.messages.length) {
      queue.sendStartedAt = Date.now()
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
    queue = { messages: [], sending: false, closed: false, sendStartedAt: 0 }
    SEND_QUEUES.set(sse, queue)
    const connectionQueue = queue
    sse.onClose?.(() => {
      connectionQueue.closed = true
      connectionQueue.messages.length = 0
    })
  }
  if (queue.closed) return
  // The queue grows only here, so the limits are checked only here.
  if (
    queue.messages.length >= MAX_QUEUED_MESSAGES ||
    (queue.sending && Date.now() - queue.sendStartedAt > STALL_TIMEOUT_MS)
  ) {
    dropConnection(sse, queue)
    return
  }
  queue.messages.push(message)
  if (!queue.sending) void flush(sse, queue)
}
