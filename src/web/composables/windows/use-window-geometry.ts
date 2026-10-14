import { WINDOW_BASE_Z_INDEX } from '@/constants/windows/constants'
import { computed } from 'vue'
import { useQuasar, type TouchPanValue } from 'quasar'
import { withoutWindowMotion } from '@/utils/windows/window-elements'
import { useWindowStore } from '@/stores/windows/window-store'
import {
  clampWindowPosition,
  windowLayoutRect,
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
  const layout = computed(() => windowLayoutRect(state, viewport.value))
  const size = computed(() => ({
    width: layout.value.width,
    height: layout.value.height
  }))
  const position = computed(() => ({ x: layout.value.x, y: layout.value.y }))
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
      if (state.mode === 'left' || state.mode === 'right') {
        const rect = { ...position.value, ...size.value }
        withoutWindowMotion(id, () => {
          state.mode = 'normal'
        })
        const left = event.position?.left ?? rect.x + rect.width / 2
        const top = event.position?.top ?? rect.y + 24
        const ratio = Math.max(0, Math.min(1, (left - rect.x) / rect.width))
        state.position = clampWindowPosition(
          {
            x: left - size.value.width * ratio,
            y: top - Math.min(24, top - rect.y)
          },
          size.value,
          viewport.value
        )
      }
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
    ) {
      return
    }
    event.preventDefault()
    store.focus(id)
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = { ...position.value, ...size.value }
    if (state.mode === 'left' || state.mode === 'right') {
      withoutWindowMotion(id, () => {
        state.mode = 'normal'
      })
      state.position = { x: rect.x, y: rect.y }
      state.windowSize = { width: rect.width, height: rect.height }
    }
    active = {
      edge,
      pointerId: event.pointerId,
      start: rect,
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
