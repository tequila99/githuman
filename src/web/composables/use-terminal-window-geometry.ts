import { computed } from 'vue'
import { useQuasar, type TouchPanValue } from 'quasar'
import { useTerminalStore } from '@/stores/terminal-store'
import {
  clampTerminalPosition,
  resizeTerminalWindow,
  terminalWindowSize,
  type ResizeEdge,
  type WindowPoint,
  type WindowRect
} from '@/utils/terminal-window'

export type PanEvent = Parameters<Exclude<TouchPanValue, undefined>>[0]

/** The size and position of the terminal window, from the store and the viewport. */
export function useTerminalWindowGeometry() {
  const $q = useQuasar()
  const store = useTerminalStore()
  const viewport = computed(() => ({
    width: $q.screen.width,
    height: $q.screen.height
  }))
  const size = computed(() =>
    store.maximized
      ? viewport.value
      : terminalWindowSize(store.windowSize, viewport.value)
  )
  const position = computed(() =>
    store.maximized
      ? { x: 0, y: 0 }
      : clampTerminalPosition(store.position, size.value, viewport.value)
  )
  const style = computed(() => ({
    left: `${position.value.x}px`,
    top: `${position.value.y}px`,
    width: `${size.value.width}px`,
    height: `${size.value.height}px`
  }))
  let dragStart: WindowPoint = { x: 0, y: 0 }

  function drag(event: PanEvent): void {
    if (store.maximized) return
    if (event.isFirst) dragStart = { ...position.value }
    store.position = clampTerminalPosition(
      {
        x: dragStart.x + (event.offset?.x ?? 0),
        y: dragStart.y + (event.offset?.y ?? 0)
      },
      size.value,
      viewport.value
    )
    if (event.isFinal) store.remember()
  }

  return { viewport, size, position, style, drag }
}

/**
 * Resize by one edge handle. The handle captures the pointer, so it gets the
 * release even outside the browser window. Lost capture ends the resize too.
 */
export function useTerminalWindowResize() {
  const store = useTerminalStore()
  const { viewport, size, position } = useTerminalWindowGeometry()
  let active: {
    edge: ResizeEdge
    pointerId: number
    start: WindowRect
    pointer: WindowPoint
  } | null = null

  function start(event: PointerEvent, edge: ResizeEdge): void {
    if (store.maximized || event.button !== 0) return
    if (!(event.currentTarget instanceof Element)) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    active = {
      edge,
      pointerId: event.pointerId,
      start: { ...position.value, ...size.value },
      pointer: { x: event.clientX, y: event.clientY }
    }
  }

  function move(event: PointerEvent): void {
    if (active?.pointerId !== event.pointerId) return
    const delta = {
      x: event.clientX - active.pointer.x,
      y: event.clientY - active.pointer.y
    }
    const { x, y, width, height } = resizeTerminalWindow(
      active.start,
      active.edge,
      delta,
      viewport.value
    )
    store.position = { x, y }
    store.windowSize = { width, height }
  }

  // Release and lost capture both arrive for one resize. Only the first one saves.
  function end(event: PointerEvent): void {
    if (active?.pointerId !== event.pointerId) return
    active = null
    store.remember()
  }

  return { start, move, end }
}
