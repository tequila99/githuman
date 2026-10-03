/** The part of `reply.sse` that `safeSend` needs. */
export interface SseSender {
  readonly isConnected: boolean
  send: (message: {
    id?: string
    event: string
    data: unknown
  }) => Promise<void>
}

/**
 * Sends one SSE message and never fails. A client can leave at any time, and
 * `send` then rejects. Nothing awaits that promise, so Node would end the
 * process on the unhandled rejection.
 */
export function safeSend(
  sse: SseSender,
  message: { id?: string; event: string; data: unknown }
): void {
  if (!sse.isConnected) {
    return
  }
  sse.send(message).catch(() => {})
}
