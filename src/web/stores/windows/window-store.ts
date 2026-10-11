import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { safeStorage } from '@/utils/safe-storage'
import { isRecord, isFiniteNumber } from '@/utils/guards'
import { DOCK_EDGES } from '@/constants/windows/constants'
import type { DockState, WindowState, WindowMode } from '@/types/windows/window'

// Common preferences are separate from application data and server sessions.
const STORAGE_KEY = 'githuman:windows:v1'
// Reject preferences written with an incompatible schema.
const STORAGE_VERSION = 1
// A new window starts away from the navigation panel and app header.
const DEFAULT_POSITION = { x: 260, y: 120 }
// These property names cannot identify windows in an object-backed registry.
const RESERVED_WINDOW_IDS = new Set(['__proto__', 'constructor', 'prototype'])

// The `maximized` field stays for old callers. It is a view of `mode`.
// JSON.stringify writes both fields, so older builds still read `maximized`.
function createWindowState(
  fields: Omit<WindowState, 'maximized'>
): WindowState {
  return {
    ...fields,
    get maximized() {
      return this.mode === 'maximized'
    },
    set maximized(maximized: boolean) {
      this.mode = maximized ? 'maximized' : 'normal'
    }
  }
}

function parseWindow(value: unknown): WindowState | null {
  if (
    !isRecord(value) ||
    !isRecord(value.position) ||
    !isFiniteNumber(value.position.x) ||
    !isFiniteNumber(value.position.y)
  )
    return null
  const size = value.windowSize
  return createWindowState({
    position: { x: value.position.x, y: value.position.y },
    windowSize:
      isRecord(size) &&
      isFiniteNumber(size.width) &&
      isFiniteNumber(size.height) &&
      size.width > 0 &&
      size.height > 0
        ? { width: size.width, height: size.height }
        : null,
    open: value.open === true,
    minimized: value.minimized === true,
    mode:
      value.mode === 'normal' ||
      value.mode === 'maximized' ||
      value.mode === 'left' ||
      value.mode === 'right'
        ? value.mode
        : value.maximized === true
          ? 'maximized'
          : 'normal'
  })
}
export const useWindowStore = defineStore('windows', () => {
  const windows = ref<Record<string, WindowState>>({})
  const order = ref<string[]>([])
  let minimizedOrder: string[] = []
  const dock = ref<DockState>({ edge: 'bottom', position: null })
  try {
    const saved: unknown = JSON.parse(safeStorage.get(STORAGE_KEY) ?? 'null')
    if (isRecord(saved) && saved.version === STORAGE_VERSION) {
      if (isRecord(saved.windows)) {
        for (const [id, value] of Object.entries(saved.windows)) {
          if (RESERVED_WINDOW_IDS.has(id)) continue
          const state = parseWindow(value)
          if (state) windows.value[id] = state
        }
      }
      if (Array.isArray(saved.order))
        order.value = saved.order.filter(
          (id): id is string =>
            typeof id === 'string' && Object.hasOwn(windows.value, id)
        )
      const panel = saved.dock
      if (isRecord(panel)) {
        const edge = DOCK_EDGES.find(candidate => candidate === panel.edge)
        if (edge) dock.value.edge = edge
        if (
          isRecord(panel.position) &&
          isFiniteNumber(panel.position.x) &&
          isFiniteNumber(panel.position.y)
        )
          dock.value.position = { x: panel.position.x, y: panel.position.y }
      }
    }
  } catch {
    /* Invalid preferences do not prevent window access. */
  }
  function remember() {
    safeStorage.set(
      STORAGE_KEY,
      JSON.stringify({
        version: STORAGE_VERSION,
        windows: windows.value,
        order: order.value,
        dock: dock.value
      })
    )
  }
  function ensure(id: string): WindowState {
    if (!id || RESERVED_WINDOW_IDS.has(id)) throw new Error('Invalid window id')
    if (!Object.hasOwn(windows.value, id)) {
      windows.value[id] = createWindowState({
        position: { ...DEFAULT_POSITION },
        windowSize: null,
        open: false,
        minimized: false,
        mode: 'normal'
      })
    }
    return windows.value[id]!
  }
  function focus(id: string) {
    const state = ensure(id)
    state.open = true
    state.minimized = false
    order.value = [...order.value.filter(key => key !== id), id]
    remember()
  }
  function close(id: string) {
    ensure(id).open = false
    order.value = order.value.filter(key => key !== id)
    remember()
  }
  const activeId = computed(
    () =>
      order.value.findLast(
        id => windows.value[id]?.open && !windows.value[id]?.minimized
      ) ?? null
  )
  function isActive(id: string) {
    return activeId.value === id
  }
  function minimize(id: string) {
    const state = ensure(id)
    if (!state.open || state.minimized) return
    state.minimized = true
    minimizedOrder = [...minimizedOrder.filter(key => key !== id), id]
    remember()
  }
  function minimizeAll() {
    for (const id of order.value) minimize(id)
    remember()
  }
  function restoreLastMinimized(): boolean {
    if (activeId.value) return false
    const id = [...order.value, ...minimizedOrder].findLast(
      key => windows.value[key]?.open && windows.value[key]?.minimized
    )
    if (!id) return false
    minimizedOrder = minimizedOrder.filter(key => key !== id)
    focus(id)
    return true
  }
  function toggleMode(id: string, mode: Exclude<WindowMode, 'normal'>) {
    const state = ensure(id)
    state.mode = state.mode === mode ? 'normal' : mode
    remember()
  }
  watch(dock, remember, { deep: true })
  return {
    windows,
    order,
    dock,
    activeId,
    ensure,
    focus,
    close,
    isActive,
    minimize,
    minimizeAll,
    restoreLastMinimized,
    toggleMode,
    remember
  }
})
