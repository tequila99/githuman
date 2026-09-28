import { SERVER_EVENT_TYPES, type ServerEventType } from '@/api/types'

type Subscriber = { eventTypes: Set<ServerEventType>; onChange: () => void }

// A browser only gives up on an EventSource for good (readyState CLOSED)
// after an HTTP error, e.g. the dev proxy answering 500 while the backend
// restarts. A refused connection (production restart) it retries by itself.
const RECONNECT_DELAY_MS = 2000

const subscribers = new Set<Subscriber>()
let source: EventSource | null = null
// An error since the last 'open' means events may have been missed while
// the connection was down.
let missedEvents = false

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
  es.addEventListener('open', () => {
    if (missedEvents) notify(() => true)
    missedEvents = false
  })
  es.addEventListener('error', () => {
    missedEvents = true
    if (es.readyState === EventSource.CLOSED) {
      setTimeout(connect, RECONNECT_DELAY_MS)
    }
  })
  source = es
}

/**
 * Subscribes to the backend's SSE stream (`GET /api/events`), calling
 * `onChange` whenever one of `eventTypes` arrives — and once after a
 * reconnect, to catch up on anything missed while the connection was down.
 * Not on the first connect: callers do their own initial fetch on mount.
 *
 * All subscribers share one EventSource, opened on first use and kept for
 * the lifetime of the tab (every page but the 404 subscribes anyway).
 */
export function useServerEvents(
  eventTypes: ServerEventType[],
  onChange: () => void
): { close: () => void } {
  if (!source) connect()

  const subscriber: Subscriber = { eventTypes: new Set(eventTypes), onChange }
  subscribers.add(subscriber)

  return {
    close() {
      subscribers.delete(subscriber)
    }
  }
}

if (import.meta.hot) {
  // A reloaded copy of this module opens its own connection.
  import.meta.hot.dispose(() => source?.close())
}
