// Calendar inputs use a fixed format independent of the display locale.
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// Require an explicit time zone and millisecond precision at most.
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/

export function toIsoString(timestampMs: number): string {
  return new Date(timestampMs).toISOString()
}

export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_PATTERN.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  // Reject days that Date silently rolls into the following month.
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  )
}

/** Returns UTC milliseconds, or null for malformed timestamps and impossible calendar dates. */
export function parseIsoTimestamp(value: string): number | null {
  if (
    !ISO_TIMESTAMP_PATTERN.test(value) ||
    !isCalendarDate(value.slice(0, 10))
  ) {
    return null
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}
