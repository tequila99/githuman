import createError from '@fastify/error'

// @fastify/error matches instanceof by code, so a subclass cannot be told apart.
// Markers keep the public code GHT_ARTIFACT_CONFLICT while callers still can.
const BUSY = Symbol('artifact.busy')
const LEASE_BUSY = Symbol('artifact.leaseBusy')

export const ArtifactInputError = createError(
  'GHT_ARTIFACT_INVALID_INPUT',
  '%s',
  400
)
export const ArtifactNotFoundError = createError(
  'GHT_ARTIFACT_NOT_FOUND',
  'Artifact not found.',
  404
)
export const ArtifactReportTextNotFoundError = createError(
  'GHT_ARTIFACT_REPORT_TEXT_NOT_FOUND',
  'The validation has no report text.',
  404
)
export const ArtifactConflictError = createError(
  'GHT_ARTIFACT_CONFLICT',
  '%s',
  409
)
function marked(message: string, marker: symbol): Error {
  return Object.assign(new ArtifactConflictError(message), { [marker]: true })
}

/** The database is locked by another writer; the same call can succeed later. */
export function artifactBusyError(message: string): Error {
  return marked(message, BUSY)
}
/** Another validation job holds the store lease; start again when it ends. */
export function artifactLeaseBusyError(message: string): Error {
  return marked(message, LEASE_BUSY)
}
export function isArtifactBusyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && BUSY in error
}
export function isArtifactLeaseBusyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && LEASE_BUSY in error
}
export const ArtifactIntegrityError = createError(
  'GHT_ARTIFACT_INTEGRITY',
  '%s',
  422
)
export const ArtifactTooLargeError = createError(
  'GHT_ARTIFACT_TOO_LARGE',
  'Artifact exceeds the storage limit.',
  413
)
export const ArtifactSearchUnavailableError = createError(
  'GHT_ARTIFACT_SEARCH_UNAVAILABLE',
  'Artifact search is unavailable: SQLite FTS5 unicode61 and trigram are required.',
  503
)
