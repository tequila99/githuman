import type { ArtifactTransitionOperation } from '@/api/types'

// Verdicts for which the validator saved a report that can be read.
const READABLE_VERDICTS = ['conflict', 'incomplete', 'pass']

/** True when the operation has a validation report the user can open. */
export function hasValidationResult(
  operation: Pick<ArtifactTransitionOperation, 'validationId' | 'verdict'>
): boolean {
  return (
    operation.validationId !== null &&
    operation.verdict !== null &&
    READABLE_VERDICTS.includes(operation.verdict)
  )
}
