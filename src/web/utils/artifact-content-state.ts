import { ApiRequestError } from '@/api/client'
import { ArtifactContentError } from '@/utils/artifact-content'

// The server code for a stored file that failed its integrity check.
const INTEGRITY_CODE = 'GHT_ARTIFACT_INTEGRITY'

export type ArtifactContentState = 'idle' | 'loading' | 'ready' | 'error'
export type ArtifactContentErrorKind =
  | 'integrity'
  | 'access'
  | 'transport'
  | 'abort'

/** Classifies a failed content read by type and code, never by message text. */
export function classifyContentError(error: unknown): ArtifactContentErrorKind {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'abort'
  }
  if (error instanceof ArtifactContentError) {
    return 'integrity'
  }
  if (error instanceof ApiRequestError) {
    if (error.code === INTEGRITY_CODE) {
      return 'integrity'
    }
    if (error.status === 401 || error.status === 403) {
      return 'access'
    }
  }
  return 'transport'
}

/** A new status change needs verified content; progress and cancel never do. */
export function canStartTransition(state: ArtifactContentState): boolean {
  return state === 'ready'
}

/** Known corruption blocks the context and the original export; a failed read does not prove it. */
export function canUseOriginal(kind: ArtifactContentErrorKind | null): boolean {
  return kind !== 'integrity'
}
