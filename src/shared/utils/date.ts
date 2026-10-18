export function toIsoString(timestampMs: number): string {
  return new Date(timestampMs).toISOString()
}
