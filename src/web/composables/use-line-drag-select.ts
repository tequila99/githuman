import { onMounted, onUnmounted, ref } from 'vue'

export interface DragSelection {
  column: string
  startKey: number
  endKey: number
}

/**
 * Drag-to-select state machine for a GitHub-style gutter line range,
 * confined to whichever column the drag started in (see ADR 0017 AC12) — a
 * `enter()` for a different column, or for a row with no line number in the
 * active column (caller simply doesn't call `enter` for it), doesn't extend
 * the range. A single `mousedown` with no drag movement produces a
 * single-line range once `mouseup` fires.
 */
export function useLineDragSelect(
  onFinish: (selection: DragSelection) => void
) {
  const active = ref<{ column: string; start: number; current: number } | null>(
    null
  )

  function start(column: string, key: number) {
    active.value = { column, start: key, current: key }
  }

  function enter(column: string, key: number) {
    if (!active.value || active.value.column !== column) return
    active.value.current = key
  }

  function isSelected(column: string, key: number): boolean {
    if (!active.value || active.value.column !== column) return false
    const lo = Math.min(active.value.start, active.value.current)
    const hi = Math.max(active.value.start, active.value.current)
    return key >= lo && key <= hi
  }

  function handleWindowMouseUp() {
    if (!active.value) return
    const { column, start: startKey, current } = active.value
    active.value = null
    onFinish({
      column,
      startKey: Math.min(startKey, current),
      endKey: Math.max(startKey, current)
    })
  }

  onMounted(() => window.addEventListener('mouseup', handleWindowMouseUp))
  onUnmounted(() => window.removeEventListener('mouseup', handleWindowMouseUp))

  return { start, enter, isSelected }
}
