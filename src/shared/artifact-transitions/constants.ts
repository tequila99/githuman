// A preview lives in server memory; the user must confirm before it expires.
export const TRANSITION_PREVIEW_TTL_MS = 10 * 60_000
// Prior consent expires; validation (10 minutes) must finish inside it.
export const TRANSITION_CONSENT_TTL_MS = 15 * 60_000
// An owner without a heartbeat for this long counts as dead (ADR 0108). It stays
// above the five-second database busy timeout that can stall the event loop.
export const HEARTBEAT_STALE_MS = 30_000
// Stages after which an operation never changes.
export const TRANSITION_TERMINAL_STAGES = [
  'succeeded',
  'failed',
  'cancelled',
  'interrupted'
] as const
// All stages of a transition operation in order of progress.
export const TRANSITION_STAGES = [
  'preparing',
  'validating',
  'applying',
  ...TRANSITION_TERMINAL_STAGES
] as const
