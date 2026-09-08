/**
 * Subscribes to the backend's SSE stream (`GET /api/events`) for the given
 * event types, calling `onChange` whenever one arrives — and once more as
 * soon as the connection opens, to catch up on anything missed while it was
 * down (`EventSource` reconnects automatically on drop).
 */
export function useServerEvents(
  eventTypes: string[],
  onChange: () => void
): { close: () => void } {
  const source = new EventSource('/api/events')

  for (const type of eventTypes) {
    source.addEventListener(type, () => onChange())
  }

  source.addEventListener('open', () => onChange())

  return { close: () => source.close() }
}
