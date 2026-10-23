// A tap leaves native scrolling available; a pointer cancellation never selects a line.
const TAP_DISTANCE_PX = 8
// Touch generates compatibility mouse events after pointer events.
const COMPATIBILITY_MOUSE_DELAY_MS = 750

export function useGutterTap<T>(tap: (value: T) => void) {
  let pointer: { id: number; x: number; y: number; value: T } | null = null
  let ignoreMouseUntil = 0
  function down(event: PointerEvent, value: T) {
    if (event.pointerType === 'mouse') return
    ignoreMouseUntil = Date.now() + COMPATIBILITY_MOUSE_DELAY_MS
    pointer = event.isPrimary
      ? { id: event.pointerId, x: event.clientX, y: event.clientY, value }
      : null
  }
  // The browser sends compatibility mouse events after the touch ends, not after it starts.
  function extendMouseWindow() {
    ignoreMouseUntil = Date.now() + COMPATIBILITY_MOUSE_DELAY_MS
  }
  function up(event: PointerEvent) {
    const start = pointer
    pointer = null
    if (event.pointerType !== 'mouse') extendMouseWindow()
    if (
      start?.id === event.pointerId &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) <=
        TAP_DISTANCE_PX
    ) {
      tap(start.value)
    }
  }
  function cancel() {
    if (pointer) extendMouseWindow()
    pointer = null
  }
  return {
    down,
    up,
    cancel,
    mouseAllowed: () => Date.now() >= ignoreMouseUntil
  }
}
