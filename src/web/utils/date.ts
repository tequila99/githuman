// Use one display format across the interface, in the browser locale and time zone.
const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})

// Calendar inputs use a fixed format independent of the display locale.
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function formatDateTime(value: string | number): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : DATE_FORMATTER.format(date)
}

export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_PATTERN.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  // Reject invalid dates and days that Date silently rolls into the following month.
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  )
}

function localDay(value: string, end: boolean): string {
  if (!isCalendarDate(value)) throw new RangeError('Invalid calendar date.')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(0)
  // The Date constructor maps years 0–99 to 1900–1999; setFullYear preserves the input year.
  date.setFullYear(year!, month! - 1, day)
  // Local boundaries follow daylight saving transitions instead of assuming a fixed 24-hour day.
  date.setHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0)
  return date.toISOString()
}

export function localDayStartIso(value: string): string {
  return localDay(value, false)
}

export function localDayEndIso(value: string): string {
  return localDay(value, true)
}
