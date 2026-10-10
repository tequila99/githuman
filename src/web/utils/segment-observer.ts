// How far outside the scroll window a row segment mounts, in px. A quick
// scroll must not show an empty placeholder.
export const MOUNT_MARGIN_PX = 2000

/** What a row segment hears about its position. */
export interface SegmentHandler {
  /** The segment entered (true) or left (false) the mount margin. */
  near: (near: boolean, element: Element) => void
  /** The segment entered (true) or left (false) the scroll window itself. */
  visible: (visible: boolean) => void
}

interface RootObservers {
  near: IntersectionObserver
  visible: IntersectionObserver
  handlers: Map<Element, SegmentHandler>
}

// Each root and margin share observers; cards can prepare earlier than their rows.
const roots = new WeakMap<Element, Map<number, RootObservers>>()

function observersFor(root: Element, margin: number): RootObservers {
  let groups = roots.get(root)
  if (!groups) {
    groups = new Map()
    roots.set(root, groups)
  }
  const existing = groups.get(margin)
  if (existing) return existing
  const handlers = new Map<Element, SegmentHandler>()
  // An entry can arrive after its element is no longer observed. Ignore it.
  const near = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        handlers.get(entry.target)?.near(entry.isIntersecting, entry.target)
      }
    },
    { root, rootMargin: `${margin}px 0px` }
  )
  const visible = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        handlers.get(entry.target)?.visible(entry.isIntersecting)
      }
    },
    { root }
  )
  const created = { near, visible, handlers }
  groups.set(margin, created)
  return created
}

/**
 * Watches `element` inside the scroll `root`. Returns the function that stops
 * the watch. The last stopped watch also stops the observers of the root.
 */
export function observeSegment(
  root: Element,
  element: Element,
  handler: SegmentHandler,
  margin = MOUNT_MARGIN_PX
): () => void {
  const observers = observersFor(root, margin)
  observers.handlers.set(element, handler)
  observers.near.observe(element)
  observers.visible.observe(element)
  return () => {
    // A new watch of the same element replaced this one: keep it.
    if (observers.handlers.get(element) !== handler) return
    observers.handlers.delete(element)
    observers.near.unobserve(element)
    observers.visible.unobserve(element)
    if (observers.handlers.size > 0) return
    observers.near.disconnect()
    observers.visible.disconnect()
    const groups = roots.get(root)
    groups?.delete(margin)
    if (groups?.size === 0) roots.delete(root)
  }
}
