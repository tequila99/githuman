// Bound each journal entry before it reaches storage or a prompt.
export const MAX_JOURNAL_ENTRY_BYTES = 8 * 1024
// Bound one journal page response; entries are packed whole.
export const MAX_JOURNAL_PAGE_BYTES = 64 * 1024
// Default page size when a reader does not request a limit.
export const DEFAULT_JOURNAL_PAGE_LIMIT = 30
// Bound the complete handoff resource, including its framing.
export const MAX_HANDOFF_BYTES = 64 * 1024
// A preview remains reviewable without reserving an agent session.
export const HANDOFF_PREVIEW_TTL_MS = 10 * 60 * 1000
// Finished handoff receipts and their snapshots are kept for replay, then removed.
export const HANDOFF_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
// Server facts of the journal; the event type is data, not entry text.
export const JOURNAL_EVENT_TYPES = [
  'agent_event',
  'turn_finished',
  'turn_cancelled',
  'turn_failed',
  'handoff_completed',
  'handoff_failed'
] as const
