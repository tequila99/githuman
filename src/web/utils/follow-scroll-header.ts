// Late hunks can change preceding heights; bound correction instead of guessing readiness.
export const SCROLL_FOLLOW_MS = 3000

interface FollowHeaderOptions {
  root: Element
  header: () => Element | null
  now?: () => number
  requestFrame?: (callback: () => void) => number
  cancelFrame?: (id: number) => void
}

/** Keeps a selected header aligned until cancellation or the elapsed-time deadline. */
export function followScrollHeader(options: FollowHeaderOptions): () => void {
  const now = options.now ?? (() => performance.now())
  const requestFrame =
    options.requestFrame ?? (callback => requestAnimationFrame(callback))
  const cancelFrame = options.cancelFrame ?? (id => cancelAnimationFrame(id))
  const deadline = now() + SCROLL_FOLLOW_MS
  let stopped = false
  let frame: number | undefined
  function stop() {
    stopped = true
    if (frame !== undefined) cancelFrame(frame)
    frame = undefined
  }
  function align() {
    frame = undefined
    if (stopped) return
    if (now() >= deadline) {
      stop()
      return
    }
    const header = options.header()
    if (header) {
      const root = options.root
      const delta =
        header.getBoundingClientRect().top -
        root.getBoundingClientRect().top -
        root.clientTop
      const next = Math.max(
        0,
        Math.min(root.scrollHeight - root.clientHeight, root.scrollTop + delta)
      )
      if (Math.abs(next - root.scrollTop) > 0.5) root.scrollTop = next
    }
    frame = requestFrame(align)
  }
  frame = requestFrame(align)
  return stop
}
