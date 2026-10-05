// A MessageChannel task has no 4 ms clamp, which setTimeout gets after a few nested calls.
// `scheduler.yield()` is not used: its continuation runs before rendering, so a loop of
// short slices still starves paint and IntersectionObserver callbacks.

/** Lets the thread handle messages and paint, then continues. */
export function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel === 'undefined') {
    return new Promise(resolve => setTimeout(resolve, 0))
  }
  return new Promise(resolve => {
    const { port1, port2 } = new MessageChannel()
    port1.addEventListener(
      'message',
      () => {
        port1.close()
        resolve()
      },
      { once: true }
    )
    port1.start()
    port2.postMessage(null)
  })
}
