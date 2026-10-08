// Rows that one frame may mount for segments that are only near the window.
// One row costs about 0.25 ms of script and layout, and a large list adds
// style, layout and paint to each frame. 40 rows keep such a frame short (ADR 0040).
export const ROW_BUDGET = 40

// Rows that one frame may mount for visible segments. The user already sees
// their placeholders, so a longer frame is better than a longer gap.
export const VISIBLE_ROW_BUDGET = 120

/** A queued mount. The segment changes its priority or cancels it. */
export interface MountJob {
  /** A visible job goes before the jobs that are only near the window. */
  setVisible: (visible: boolean) => void
  cancel: () => void
}

interface Job {
  cost: number
  visible: boolean
  run: () => void
}

type FrameScheduler = (callback: () => void) => void

const queue = new Set<Job>()
let scheduled = false
let scheduleFrame: FrameScheduler = callback => requestAnimationFrame(callback)

/**
 * Runs visible jobs until the frame spends the visible budget, then other jobs
 * until it spends the normal budget. Jobs run in the order of the queue. The
 * first job of a frame always runs, even when it is larger than the budget.
 */
function flush() {
  scheduled = false
  const jobs = [...queue]
  const ordered = [
    ...jobs.filter(job => job.visible),
    ...jobs.filter(job => !job.visible)
  ]
  let spent = 0
  try {
    for (const job of ordered) {
      const budget = job.visible ? VISIBLE_ROW_BUDGET : ROW_BUDGET
      if (spent > 0 && spent + job.cost > budget) break
      queue.delete(job)
      spent += job.cost
      job.run()
    }
  } finally {
    // A failed job must not strand the remaining jobs. The error still propagates.
    if (queue.size > 0) schedule()
  }
}

function schedule() {
  if (scheduled) return
  scheduled = true
  scheduleFrame(flush)
}

/** Queues the mount of `cost` rows. `run` does the mount in a later frame. */
export function queueMount(
  cost: number,
  run: () => void,
  visible = false
): MountJob {
  const job: Job = { cost: Math.max(1, cost), visible, run }
  queue.add(job)
  schedule()
  return {
    setVisible: value => {
      job.visible = value
    },
    cancel: () => {
      queue.delete(job)
    }
  }
}

/** For tests: replaces the frame scheduler and clears the queue. */
export function resetMountQueue(scheduler?: FrameScheduler) {
  queue.clear()
  scheduled = false
  scheduleFrame = scheduler ?? (callback => requestAnimationFrame(callback))
}
