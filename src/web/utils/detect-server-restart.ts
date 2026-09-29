import type { ServerHello } from '@/api/types'

/**
 * Compares instance ids rather than reacting to any reconnect: a network
 * blip reconnects to the same instance and must not reload the page (#29).
 */
export function detectServerRestart(
  onRestart: () => void
): (hello: ServerHello) => void {
  let knownInstanceId: string | null = null
  let restarted = false

  return ({ instanceId }) => {
    if (knownInstanceId === null) {
      knownInstanceId = instanceId
      return
    }
    if (restarted || instanceId === knownInstanceId) return
    restarted = true
    onRestart()
  }
}
