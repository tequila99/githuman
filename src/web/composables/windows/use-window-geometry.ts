import { WINDOW_BASE_Z_INDEX } from '@/constants/windows/constants'
import { computed } from 'vue'
import { useQuasar, type TouchPanValue } from 'quasar'
import { useWindowStore } from '@/stores/windows/window-store'
import {
  clampWindowPosition,
  windowSize,
  resizeWindow
} from '@/utils/windows/window-geometry'
import type {
  ResizeEdge,
  WindowPoint,
  WindowRect
} from '@/types/windows/window'

// The viewport origin anchors maximized windows and initializes drag coordinates.
const ORIGIN: Readonly<WindowPoint> = { x: 0, y: 0 }

export type WindowPanEvent = Parameters<Exclude<TouchPanValue, undefined>>[0]
export function useWindowGeometry(
  id: string,
  minimum?: { width: number; height: number }
) {
  const store = useWindowStore()
  const $q = useQuasar()
  const state = store.ensure(id)
  const viewport = computed(() => ({
    width: $q.screen.width,
    height: $q.screen.height
  }))
  const size = computed(() =>
    state.maximized
      ? viewport.value
      : windowSize(state.windowSize, viewport.value)
  )
  const position = computed(() =>
    state.maximized
      ? { ...ORIGIN }
      : clampWindowPosition(state.position, size.value, viewport.value)
  )
  const style = computed(() => ({
    left: `${position.value.x}px`,
    top: `${position.value.y}px`,
    width: `${size.value.width}px`,
    height: `${size.value.height}px`,
    zIndex: WINDOW_BASE_Z_INDEX + Math.max(0, store.order.indexOf(id))
  }))
  let dragStart = { ...ORIGIN }
  let active: {
    edge: ResizeEdge
    pointerId: number
    start: WindowRect
    pointer: { x: number; y: number }
  } | null = null
  function drag(event: WindowPanEvent) {
    if (state.maximized) return
    if (event.isFirst) {
      dragStart = { ...position.value }
      store.focus(id)
    }
    state.position = clampWindowPosition(
      {
        x: dragStart.x + (event.offset?.x ?? 0),
        y: dragStart.y + (event.offset?.y ?? 0)
      },
      size.value,
      viewport.value
    )
    if (event.isFinal) store.remember()
  }
  function start(event: PointerEvent, edge: ResizeEdge) {
    if (
      state.maximized ||
      event.button !== 0 ||
      !(event.currentTarget instanceof Element)
    )
      return
    event.preventDefault()
    store.focus(id)
    event.currentTarget.setPointerCapture(event.pointerId)
    active = {
      edge,
      pointerId: event.pointerId,
      start: { ...position.value, ...size.value },
      pointer: { x: event.clientX, y: event.clientY }
    }
  }
  function move(event: PointerEvent) {
    if (active?.pointerId !== event.pointerId) return
    const rect = resizeWindow(
      active.start,
      active.edge,
      {
        x: event.clientX - active.pointer.x,
        y: event.clientY - active.pointer.y
      },
      viewport.value,
      minimum
    )
    state.position = { x: rect.x, y: rect.y }
    state.windowSize = { width: rect.width, height: rect.height }
  }
  function end(event: PointerEvent) {
    if (active?.pointerId !== event.pointerId) return
    active = null
    store.remember()
  }
  return { state, viewport, size, position, style, drag, start, move, end }
}
