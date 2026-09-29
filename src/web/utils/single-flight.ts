/**
 * No parallel runs, yet each call resolves only after a run that started
 * after it: the run in flight may predate the change that prompted the call,
 * so joining it could return stale data (#37). Calls made during a run share
 * one follow-up.
 */
export function singleFlight(run: () => Promise<void>): () => Promise<void> {
  let current: Promise<void> | null = null
  let followUp: Promise<void> | null = null

  function start(): Promise<void> {
    const promise = run().finally(() => {
      // With a follow-up queued, keep `current` set until it starts, so a
      // call landing in between joins it rather than starting a parallel run.
      if (current === promise && !followUp) current = null
    })
    current = promise
    return promise
  }

  return () => {
    if (!current) return start()

    // Settles whether the current run resolves or rejects; its own callers
    // get that outcome, callers of the follow-up get the follow-up's.
    followUp ??= current
      .catch(() => {})
      .then(() => {
        // Reset before starting, so a call made while the follow-up runs
        // queues a new one instead of joining a run older than itself.
        followUp = null
        return start()
      })
    return followUp
  }
}
