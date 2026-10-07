// Bound process and emulator memory for one repository.
export const MAX_TERMINAL_SESSIONS = 8
// Keep useful history without retaining unlimited command output.
export const TERMINAL_SCROLLBACK = 5000
// Confirmed idle sessions need less orphan time than running jobs.
export const TERMINAL_IDLE_MS = 15 * 60 * 1000
// Output must not extend the lifetime of an orphaned command.
export const TERMINAL_ORPHAN_MS = 60 * 60 * 1000
// Tokens are used only for an immediate connection attempt.
export const TERMINAL_TOKEN_MS = 30_000
// Bound the shell title that the server stores and publishes.
export const TERMINAL_TITLE_LENGTH = 256
// A smaller screen cannot show a shell prompt.
export const TERMINAL_MIN_COLS = 2
export const TERMINAL_MIN_ROWS = 2
// Small screens and bounded snapshots need bounded cell dimensions.
export const TERMINAL_MAX_COLS = 300
// Bound the visible buffer as well as scrollback.
export const TERMINAL_MAX_ROWS = 100
// Keep individual input frames and output batches small.
export const TERMINAL_FRAME_BYTES = 64 * 1024
// Pause the backend before parser queues grow without limit.
export const TERMINAL_QUEUE_BYTES = 1024 * 1024
// Credit bounds each client's unacknowledged output.
export const TERMINAL_CLIENT_BYTES = 4 * 1024 * 1024
// Snapshot frames may contain a bounded screen and history.
export const TERMINAL_SNAPSHOT_BYTES = 16 * 1024 * 1024
