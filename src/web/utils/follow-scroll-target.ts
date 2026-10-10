// Late hunks can change preceding heights; bound correction instead of guessing readiness.
export const SCROLL_FOLLOW_MS = 3000

interface FollowTargetOptions {
  root: Element
  target: () => Element | null
  now?: () => number
  requestFrame?: (callback: () => void) => number
  cancelFrame?: (id: number) => void
}

/** Distance from the top of the scroll window to the top of `target`. Negative above it. */
export function offsetFromRootTop(root: Element, target: Element): number {
  return (
    target.getBoundingClientRect().top -
    root.getBoundingClientRect().top -
    root.clientTop
  )
}

/** True when the top of `target` is above the scroll window, so its sticky header is stuck. */
export function isAboveRoot(root: Element, target: Element): boolean {
  return offsetFromRootTop(root, target) < 0
}

/** The `scrollTop` of `root` that puts the top of `target` at the top of the scroll window. */
export function scrollTopToAlign(root: Element, target: Element): number {
  return Math.max(
    0,
    Math.min(
      root.scrollHeight - root.clientHeight,
      root.scrollTop + offsetFromRootTop(root, target)
    )
  )
}

/** Keeps a selected element aligned until cancellation or the elapsed-time deadline. */
export function followScrollTarget(options: FollowTargetOptions): () => void {
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
    const target = options.target()
    if (target) {
      const root = options.root
      const next = scrollTopToAlign(root, target)
      if (Math.abs(next - root.scrollTop) > 0.5) root.scrollTop = next
    }
    frame = requestFrame(align)
  }
  frame = requestFrame(align)
  return stop
}
