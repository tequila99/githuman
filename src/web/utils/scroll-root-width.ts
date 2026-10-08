interface RootWidth {
  observer: ResizeObserver
  width: number
  handlers: Set<() => void>
}

// A shared observer avoids one resize subscription per mounted row segment.
const roots = new WeakMap<Element, RootWidth>()

export function observeScrollRootWidth(
  root: Element,
  handler: () => void
): () => void {
  let state = roots.get(root)
  if (!state) {
    const created: RootWidth = {
      width: root.clientWidth,
      handlers: new Set(),
      observer: new ResizeObserver(() => {
        const width = root.clientWidth
        if (width === created.width) return
        created.width = width
        for (const notify of created.handlers) notify()
      })
    }
    state = created
    roots.set(root, state)
    state.observer.observe(root)
  }
  const current = state
  current.handlers.add(handler)
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    current.handlers.delete(handler)
    if (current.handlers.size > 0) return
    current.observer.disconnect()
    roots.delete(root)
  }
}
