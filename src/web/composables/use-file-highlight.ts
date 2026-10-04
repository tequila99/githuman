import {
  computed,
  onScopeDispose,
  ref,
  toRaw,
  toValue,
  watch,
  type MaybeRefOrGetter
} from 'vue'
import type { DiffFile } from '@/api/types'
import {
  cachedHighlight,
  highlightFileCached,
  type HighlightedToken
} from '@/composables/use-syntax-highlighting'

type LineTokens = (HighlightedToken[] | null)[]

/**
 * Syntax tokens of a file, cut into one slice per hunk. A closed card shows no code,
 * so `enabled` false skips the work. New hunks drop the old tokens.
 */
export function useFileHighlight(
  file: MaybeRefOrGetter<DiffFile>,
  enabled: MaybeRefOrGetter<boolean>
) {
  const lines = ref<LineTokens | null>(null)

  // The request in the queue. A new file, a closed card or an unmount aborts it,
  // so the queue does not tokenize files that nobody shows.
  let controller: AbortController | undefined

  function cancel() {
    controller?.abort()
    controller = undefined
  }

  watch(
    () => toValue(file),
    () => {
      cancel()
      lines.value = null
    }
  )

  watch(
    () => [toValue(file), toValue(enabled)] as const,
    async ([current, on]) => {
      if (!on) {
        cancel()
        return
      }
      if (lines.value) return
      const raw = toRaw(current)
      const cached = cachedHighlight(raw)
      if (cached !== undefined) {
        lines.value = cached
        return
      }
      cancel()
      const own = new AbortController()
      controller = own
      const result = await highlightFileCached(raw, own.signal)
      // An aborted request gives no tokens, or tokens of a file that is not shown now.
      if (own.signal.aborted || result === undefined) return
      controller = undefined
      lines.value = result
    },
    { immediate: true }
  )

  onScopeDispose(cancel)

  // `null` until the tokens arrive. Else one entry per hunk.
  const hunkTokens = computed<LineTokens[] | null>(() => {
    const all = lines.value
    if (!all) return null
    let offset = 0
    return toValue(file).hunks.map(hunk => {
      const slice = all.slice(offset, offset + hunk.lines.length)
      offset += hunk.lines.length
      return slice
    })
  })

  return { hunkTokens }
}
