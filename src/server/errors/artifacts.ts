import createError from '@fastify/error'

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
export const ArtifactConflictError = createError(
  'GHT_ARTIFACT_CONFLICT',
  '%s',
  409
)
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
