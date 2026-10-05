import {
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  toRaw,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type ShallowRef
} from 'vue'
import {
  cachedHighlight,
  canHighlight,
  highlightCached,
  type TokensByLine
} from '@/composables/use-syntax-highlighting'
import type { LineDocument } from '@/utils/shiki-engine'

// The longest hold. After it, the code shows without colors, and the colors arrive later.
// A warm engine sends the first slice much sooner.
const HOLD_LIMIT_MS = 300

/** What to tokenize. Give `null` instead of a source without lines. */
export interface HighlightSource {
  /** Identity of the content: one key means one path and one text. A new key drops the old tokens. */
  key: object
  path: string
  /** The lines of this key. Called only when the cache has no tokens for the key. */
  lines: () => string[]
  /** Parts of the lines with their own grammar state. Called right after `lines`. */
  documents?: () => LineDocument[] | undefined
}

/**
 * Syntax tokens of one text, line by line. `enabled` false skips the work: a closed card
 * shows no code. The tokens arrive in slices. `holdForTokens` is true until the first answer,
 * but not longer than {@link HOLD_LIMIT_MS}, so the view can show a spinner, not code that
 * turns colored later.
 */
export function useLineTokens(
  source: MaybeRefOrGetter<HighlightSource | null>,
  enabled: MaybeRefOrGetter<boolean>
): {
  tokens: ShallowRef<TokensByLine | null>
  holdForTokens: ComputedRef<boolean>
} {
  // Shallow: the tokens are plain data, and a deep proxy of thousands of lines costs time.
  const tokens = shallowRef<TokensByLine | null>(null)
  // True after the first answer of any kind: tokens, none, or a failure. Later
  // texts keep the old code on screen, so only the first answer holds the view.
  const answered = ref(false)
  const holdExpired = ref(false)
  // True when `tokens` holds the final answer for the key: all tokens, or none after a
  // failure. Partial tokens stay on screen, but an enabled view asks for the rest.
  let complete = false

  // The request in the queue. A new key, `enabled` false or an unmount aborts it,
  // so the queue does not tokenize text that nobody shows.
  let controller: AbortController | undefined

  function cancel() {
    controller?.abort()
    controller = undefined
  }

  // A source without a grammar has no tokens to wait for, and it does not go to the cache.
  const current = computed(() => {
    const value = toValue(source)
    return value && canHighlight(value.path) ? value : null
  })
  // The getter makes a new source object on each call, so the watchers compare the key.
  const currentKey = computed(() => {
    const value = current.value
    return value ? toRaw(value.key) : null
  })

  watch(currentKey, () => {
    cancel()
    tokens.value = null
    complete = false
  })

  function accept(result: TokensByLine | null) {
    tokens.value = result
    complete = true
    answered.value = true
  }

  watch(
    () => [currentKey.value, toValue(enabled)] as const,
    async ([key, on]) => {
      if (!on) {
        cancel()
        return
      }
      const value = current.value
      if (!key || !value || complete || controller) return
      const cached = cachedHighlight(key)
      if (cached !== undefined) {
        accept(cached)
        return
      }
      const own = new AbortController()
      controller = own
      let result
      try {
        result = await highlightCached(
          key,
          value.path,
          value.lines,
          own.signal,
          partial => {
            if (own.signal.aborted) return
            // The key is the same, so the tokens are the same. A repeat after a stop starts
            // from the first slice and must not cut the colors that are on screen.
            if (tokens.value && partial.length <= tokens.value.length) return
            tokens.value = partial
            answered.value = true
          },
          value.documents
        )
      } catch {
        result = null
      }
      // An aborted request gives no tokens, or tokens of a text that is not shown now.
      if (own.signal.aborted || result === undefined) return
      controller = undefined
      accept(result)
    },
    { immediate: true }
  )

  const wantsHold = computed(
    () => toValue(enabled) && !answered.value && current.value !== null
  )

  let holdTimer: ReturnType<typeof setTimeout> | undefined

  function stopHoldTimer() {
    clearTimeout(holdTimer)
    holdTimer = undefined
  }

  // Immediate: a card in the virtual list often mounts open and with its lines.
  watch(
    wantsHold,
    on => {
      stopHoldTimer()
      if (!on || holdExpired.value) return
      holdTimer = setTimeout(() => {
        holdExpired.value = true
      }, HOLD_LIMIT_MS)
    },
    { immediate: true }
  )

  onScopeDispose(() => {
    cancel()
    stopHoldTimer()
  })

  const holdForTokens = computed(() => wantsHold.value && !holdExpired.value)

  return { tokens, holdForTokens }
}
