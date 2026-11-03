import type { ARTIFACT_STATUSES } from '../artifacts/constants.ts'
import { TRANSITION_TERMINAL_STAGES } from './constants.ts'
import type { ArtifactTransitionStage } from './types.ts'

export type ArtifactTransitionStatus = (typeof ARTIFACT_STATUSES)[number]
export type ArtifactTransitionCommand =
  | 'accept'
  | 'reject'
  | 'archive'
  | 'delete'
  | 'restore'
  | 'return_to_draft'

// One source for server validation, preview and the status menu.
export const ARTIFACT_STATUS_TRANSITIONS: Record<
  ArtifactTransitionStatus,
  readonly ArtifactTransitionStatus[]
> = {
  draft: ['accepted', 'archived', 'deleted'],
  in_review: ['draft', 'rejected', 'accepted', 'archived', 'deleted'],
  rejected: ['draft', 'archived', 'deleted'],
  accepted: ['archived', 'deleted'],
  archived: ['draft', 'deleted'],
  deleted: ['draft', 'archived'],
  superseded: ['archived', 'deleted']
}

// Users never assign these: review was removed and replacement sets superseded.
const SYSTEM_ONLY_STATUSES: readonly ArtifactTransitionStatus[] = [
  'in_review',
  'superseded'
]

export function isTerminalTransitionStage(
  stage: ArtifactTransitionStage
): boolean {
  return TRANSITION_TERMINAL_STAGES.some(terminal => terminal === stage)
}

export function allowedTransition(
  from: ArtifactTransitionStatus,
  to: ArtifactTransitionStatus
): boolean {
  if (from === to) {
    return false
  }
  return ARTIFACT_STATUS_TRANSITIONS[from].includes(to)
}

/** Lifecycle command that gives `to` to a subject in status `from`. */
export function transitionCommand(
  from: ArtifactTransitionStatus,
  to: ArtifactTransitionStatus
): ArtifactTransitionCommand | null {
  if (!allowedTransition(from, to) || SYSTEM_ONLY_STATUSES.includes(to)) {
    return null
  }
  if (to === 'accepted') {
    return 'accept'
  }
  if (to === 'rejected') {
    return 'reject'
  }
  if (to === 'archived') {
    return 'archive'
  }
  if (to === 'deleted') {
    return 'delete'
  }
  return from === 'archived' || from === 'deleted'
    ? 'restore'
    : 'return_to_draft'
}

export interface ArtifactTransitionTargetOption {
  status: ArtifactTransitionStatus
  available: boolean
  reason: string | null
}

/** Targets a user can choose from `from`, with the reason for unavailable ones. */
export function userTransitionTargets(
  from: ArtifactTransitionStatus,
  hasSupersededHistory: boolean
): ArtifactTransitionTargetOption[] {
  return ARTIFACT_STATUS_TRANSITIONS[from]
    .filter(status => !SYSTEM_ONLY_STATUSES.includes(status))
    .map(status => {
      if (status === 'draft' && hasSupersededHistory) {
        return {
          status,
          available: false,
          reason: 'A superseded artifact requires a new revision.'
        }
      }
      return { status, available: true, reason: null }
    })
}
