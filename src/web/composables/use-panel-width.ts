import { ref } from 'vue'
import { safeStorage } from '@/utils/safe-storage'

export function clampWidth(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(width)))
}

/** The saved width, if it is a sane number; storage may be missing or blocked. */
export function readStoredWidth(
  key: string,
  min: number,
  max: number
): number | null {
  const raw = safeStorage.get(key)
  const parsed = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) ? clampWidth(parsed, min, max) : null
}

interface PanelWidthOptions {
  /** localStorage key the width is remembered under. */
  key: string
  initial: number
  min: number
  /** Upper bound; may depend on the window (read on every change). */
  max: () => number
}

/**
 * Width of a side panel resized by dragging its edge. The panel sits at the
 * right edge of the window, so dragging left (negative x offset) widens it.
 * `startDrag`/`drag` take the values of Quasar's `v-touch-pan` events.
 */
export function usePanelWidth(options: PanelWidthOptions) {
  const { key, initial, min, max } = options
  const width = ref(
    clampWidth(readStoredWidth(key, min, max()) ?? initial, min, max())
  )
  const dragging = ref(false)
  let startWidth = width.value

  function set(next: number) {
    width.value = clampWidth(next, min, max())
  }

  function persist() {
    safeStorage.set(key, String(width.value))
  }

  /** `v-touch-pan` handler. */
  function drag(event: {
    isFirst?: boolean
    isFinal?: boolean
    offset?: { x?: number }
  }) {
    if (event.isFirst) {
      startWidth = width.value
      dragging.value = true
    }
    set(startWidth - (event.offset?.x ?? 0))
    if (event.isFinal) {
      dragging.value = false
      persist()
    }
  }

  /** Arrow keys on the focused handle: ←/→ widen/narrow by `step`. */
  function nudge(direction: 'wider' | 'narrower', step = 24) {
    set(width.value + (direction === 'wider' ? step : -step))
    persist()
  }

  return { width, dragging, drag, nudge }
}
