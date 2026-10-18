// One handler: the boot decides what a lost access means (ADR 0079).
let handler: (() => void) | null = null

/** Sets the reaction to a possible loss of access. A new call replaces the old one. */
export function onAccessProblem(react: () => void): void {
  handler = react
}

/**
 * Reports an answer 401 or an event stream that the browser closed. The
 * device may have lost access; the handler checks `GET /api/access`.
 */
export function reportAccessProblem(): void {
  handler?.()
}
