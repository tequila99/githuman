import type { TouchSwipeValue } from 'quasar'
import { useWorkspaceNavigation } from './use-workspace-navigation'

// Keep browser navigation gestures available at both viewport edges.
const EDGE_GUARD_PX = 24
export function useWorkspaceSwipe() {
  const workspace = useWorkspaceNavigation()
  function start(event: TouchEvent) {
    const touch = event.touches[0]
    if (
      !workspace.narrow.value ||
      workspace.window.value ||
      event.touches.length !== 1 ||
      !touch ||
      touch.clientX < EDGE_GUARD_PX ||
      touch.clientX > window.innerWidth - EDGE_GUARD_PX ||
      window.getSelection()?.toString()
    ) {
      // Stop this element's TouchSwipe listener before it claims the gesture; native scrolling remains available.
      event.stopImmediatePropagation()
    }
  }
  const swipe: TouchSwipeValue = event => {
    const panes = workspace.projection.value.panes
    const index = panes.indexOf(workspace.pane.value)
    const next = panes[index + (event.direction === 'left' ? 1 : -1)]
    if (next) void workspace.selectPane(next)
  }
  return { start, swipe }
}
