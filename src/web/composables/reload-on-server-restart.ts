import type { ServerHello } from '@/api/types'

/**
 * Returns a ServerHello handler that calls `onRestart` once, the first time
 * a reconnect greets the page with a different server instance than the one
 * it first connected to — i.e. `githuman serve` was restarted while the page
 * stayed open (#29). A plain network blip reconnects to the same instance and
 * is ignored.
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
