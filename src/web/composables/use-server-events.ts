type Listener = { eventTypes: Set<string>; onChange: () => void }

// A browser gives up on an EventSource for good (readyState CLOSED) after an
// HTTP error or a wrong content type, e.g. while the server restarts.
const RECONNECT_DELAY_MS = 2000

const listeners = new Set<Listener>()
const attachedTypes = new Set<string>()
let source: EventSource | null = null
let connectedOnce = false
let closeTimer: ReturnType<typeof setTimeout> | undefined
let reconnectTimer: ReturnType<typeof setTimeout> | undefined

function dispatch(type: string) {
  for (const listener of listeners) {
    if (listener.eventTypes.has(type)) listener.onChange()
  }
}

function attach(type: string) {
  if (!source || attachedTypes.has(type)) return
  attachedTypes.add(type)
  source.addEventListener(type, () => dispatch(type))
}

function open() {
  source = new EventSource('/api/events')
  attachedTypes.clear()
  for (const listener of listeners) {
    for (const type of listener.eventTypes) attach(type)
  }

  source.addEventListener('open', () => {
    // The first connect is covered by every caller's own initial fetch on
    // mount; only a *re*connect needs a catch-up for what was missed.
    if (connectedOnce) {
      for (const listener of listeners) listener.onChange()
    }
    connectedOnce = true
  })

  source.addEventListener('error', () => {
    if (source?.readyState !== EventSource.CLOSED) return // Browser retries itself.
    source = null
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      if (listeners.size > 0) open()
    }, RECONNECT_DELAY_MS)
  })
}

function shutdown() {
  source?.close()
  source = null
  connectedOnce = false
  clearTimeout(reconnectTimer)
  reconnectTimer = undefined
}

/**
 * Subscribes to the backend's SSE stream (`GET /api/events`) for the given
 * event types, calling `onChange` whenever one arrives — and once more after
 * a reconnect, to catch up on anything missed while the connection was down.
 * Callers do their own initial fetch on mount; the first connect doesn't
 * trigger `onChange` (it would only duplicate that fetch). A subscriber added
 * while a reconnect is in flight may get one catch-up call on top of it.
 *
 * All subscribers in a tab share one EventSource. Closing is deferred a tick
 * so a route change (old page unmounts, then the new one mounts) reuses the
 * connection instead of dropping and reopening it.
 */
export function useServerEvents(
  eventTypes: string[],
  onChange: () => void
): { close: () => void } {
  const listener: Listener = { eventTypes: new Set(eventTypes), onChange }
  listeners.add(listener)

  clearTimeout(closeTimer)
  closeTimer = undefined
  if (source) {
    for (const type of listener.eventTypes) attach(type)
  } else if (!reconnectTimer) {
    open()
  }

  return {
    close() {
      if (!listeners.delete(listener) || listeners.size > 0) return
      closeTimer = setTimeout(() => {
        closeTimer = undefined
        if (listeners.size === 0) shutdown()
      }, 0)
    }
  }
}
