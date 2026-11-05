import type { ArtifactActionInspection } from '@/api/types'

type ArtifactActionPhase = ArtifactActionInspection['phase']

/** The store fields that decide which action the user may start. */
export interface ArtifactActionFlags {
  confirmed: boolean
  stale: boolean
  loading: boolean
  busy: boolean
  expired: boolean
}

export interface ArtifactActionAvailability {
  canApprove: boolean
  canExecute: boolean
  grantedToAgent: boolean
}

const NONE: ArtifactActionAvailability = {
  canApprove: false,
  canExecute: false,
  grantedToAgent: false
}

function fresh(flags: ArtifactActionFlags, phase: ArtifactActionPhase) {
  return (inspection: ArtifactActionInspection) =>
    inspection.phase === phase &&
    inspection.ready &&
    !flags.stale &&
    !flags.loading &&
    !flags.busy &&
    !flags.expired
}

/** The agent gets the grant, never the browser (ADR 0116). */
export function actionAvailability(
  flags: ArtifactActionFlags | null,
  inspection: ArtifactActionInspection | null
): ArtifactActionAvailability {
  if (!flags || !inspection) return NONE
  return {
    canApprove: flags.confirmed && fresh(flags, 'pending')(inspection),
    canExecute: inspection.canExecute && fresh(flags, 'authorized')(inspection),
    grantedToAgent: inspection.phase === 'authorized' && !inspection.canExecute
  }
}
