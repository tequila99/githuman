// Share one UUID layout between runtime checks and JSON schemas.
export const UUID_PATTERN_SOURCE =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
// Compile once for ID checks outside schema validation.
const UUID_PATTERN = new RegExp(UUID_PATTERN_SOURCE)

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}
