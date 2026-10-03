/** A plain object: not `null`, not an array. Narrows `JSON.parse` output before its fields are read. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
