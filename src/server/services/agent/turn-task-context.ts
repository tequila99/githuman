export interface TurnTaskContext {
  readonly turnId: string
  readonly sessionId: string
  readonly assignmentVersion: number
  readonly taskIds: readonly string[]
  readonly source?: 'turn_assignment' | 'turn_activation'
  readonly activationRequestId?: string
}

export type ArtifactTaskBinding =
  | { source: 'explicit' | 'legacy_default' }
  | {
      source: 'turn_activation'
      sessionId: string
      turnId: string
      assignmentVersion: number
      activationRequestId: string
    }
  | {
      source: 'turn_assignment'
      sessionId: string
      turnId: string
      assignmentVersion: number
    }

export type ActivatedTaskContext = TurnTaskContext & {
  readonly source: 'turn_activation'
  readonly activationRequestId: string
}
