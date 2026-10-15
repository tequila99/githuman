import type { FastifyReply } from 'fastify'

/**
 * Runs `work` with a signal that aborts when the client closes the connection
 * before the response ends. A normal finish does not abort the signal.
 */
export async function withRequestSignal<T>(
  reply: FastifyReply,
  work: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  const abort = () => {
    if (!reply.raw.writableFinished) controller.abort()
  }
  if (reply.raw.destroyed) abort()
  reply.raw.once('close', abort)
  try {
    return await work(controller.signal)
  } finally {
    reply.raw.removeListener('close', abort)
  }
}
