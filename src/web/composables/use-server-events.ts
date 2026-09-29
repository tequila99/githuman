import {
  SERVER_EVENT_TYPES,
  type ServerEventType,
  type ServerHello
} from '@/api/types'
import { parseServerHello } from '@/utils/parse-server-hello'

type Subscriber = { eventTypes: Set<ServerEventType>; onChange: () => void }

// A browser only gives up on an EventSource for good (readyState CLOSED)
// after an HTTP error, e.g. the dev proxy answering 500 while the backend
// restarts. A refused connection (production restart) it retries by itself.
const RECONNECT_DELAY_MS = 2000

const subscribers = new Set<Subscriber>()
const helloHandlers = new Set<(hello: ServerHello) => void>()
let source: EventSource | null = null
// An error since the last 'open' means events may have been missed while
// the connection was down.
let missedEvents = false
let reconnectTimer: ReturnType<typeof setTimeout> | undefined

function notify(matches: (subscriber: Subscriber) => boolean) {
  for (const subscriber of subscribers) {
    if (!matches(subscriber)) continue
    // One subscriber throwing must not keep the others from being notified.
    try {
      subscriber.onChange()
    } catch (err) {
      console.error(err)
    }
  }
}

function connect() {
  const es = new EventSource('/api/events')
  // These listeners live exactly as long as this EventSource — subscribers
  // come and go through the `subscribers` set instead.
  for (const type of SERVER_EVENT_TYPES) {
    es.addEventListener(type, () => notify(s => s.eventTypes.has(type)))
  }
  es.addEventListener('connected', event => {
    if (!(event instanceof MessageEvent)) return
    const hello = parseServerHello(event.data)
    if (!hello) return
    for (const handler of helloHandlers) {
      // Same isolation as notify(): one handler throwing must not skip the
      // others (e.g. the restart detector).
      try {
        handler(hello)
      } catch (err) {
        console.error(err)
      }
    }
  })
  // 'open' comes before 'connected'. On a reconnect to a *restarted* server
  // this catch-up still fires refetches that the page reload right after
  // throws away — one batch per tab per restart, not worth reordering for.
  es.addEventListener('open', () => {
    if (missedEvents) notify(() => true)
    missedEvents = false
  })
  es.addEventListener('error', () => {
    missedEvents = true
    if (es.readyState === EventSource.CLOSED) {
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS)
    }
  })
  source = es
}

/** Doesn't open the connection — pages do, via useServerEvents(). */
export function onServerHello(handler: (hello: ServerHello) => void): void {
  helloHandlers.add(handler)
}

/**
 * Subscribes to the backend's SSE stream (`GET /api/events`), calling
 * `onChange` whenever one of `eventTypes` arrives — and once after a
 * reconnect, to catch up on anything missed while the connection was down.
 * Not on the first connect: callers do their own initial fetch on mount. A
 * subscriber added while a reconnect is pending gets that catch-up call too.
 *
 * All subscribers share one EventSource, opened on first use and kept for
 * the lifetime of the tab (every page but the 404 subscribes anyway).
 */
export function useServerEvents(
  eventTypes: ServerEventType[],
  onChange: () => void
): { close: () => void } {
  // `source` stays set (to the dead EventSource) while a reconnect is
  // pending, so this doesn't open a second connection alongside it.
  if (!source) connect()

  const subscriber: Subscriber = { eventTypes: new Set(eventTypes), onChange }
  subscribers.add(subscriber)

  return {
    close() {
      subscribers.delete(subscriber)
    }
  }
}

// Not exported: in the app the connection lives as long as the tab, and the
// browser closes it on unload. Only HMR needs an explicit teardown.
function disconnect() {
  clearTimeout(reconnectTimer) // or the pending reconnect would revive it
  reconnectTimer = undefined
  source?.close()
  source = null
  missedEvents = false
}

if (import.meta.hot) {
  // A reloaded copy of this module opens its own connection.
  import.meta.hot.dispose(disconnect)
}
