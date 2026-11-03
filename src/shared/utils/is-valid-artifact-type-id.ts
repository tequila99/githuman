// Share the type ID format between runtime validation and HTTP schemas.
// The end-of-input assertion keeps the pattern valid for JSON Schema engines
// that treat a dollar anchor as matching before a final line break.
export const ARTIFACT_TYPE_ID_PATTERN_SOURCE =
  '^[a-z][a-z0-9_-]{0,99}(?![\\s\\S])'

// Compile once because type IDs are checked for every definition command.
const ARTIFACT_TYPE_ID_PATTERN = new RegExp(ARTIFACT_TYPE_ID_PATTERN_SOURCE)

export function isValidArtifactTypeId(value: unknown): value is string {
  return typeof value === 'string' && ARTIFACT_TYPE_ID_PATTERN.test(value)
}
