// Codes of 409 answers that a client must tell apart; a message is not a contract.
export const ARTIFACT_ERROR_CODES = {
  // The expected version is out of date; the caller must read the newer one.
  versionConflict: 'GHT_ARTIFACT_CONFLICT',
  // An accepted document keeps its tasks and links until a validated change set.
  activeGraphChange: 'GHT_ARTIFACT_ACTIVE_GRAPH_CHANGE',
  // A closed task takes no edits and no new artifacts.
  taskClosed: 'GHT_TASK_CLOSED',
  // A task cannot close while artifacts bound only to it stay active.
  taskHasActiveArtifacts: 'GHT_TASK_ACTIVE_ARTIFACTS'
} as const
