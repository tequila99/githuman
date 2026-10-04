import { ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

/**
 * Asks for the hunks of a card, but only while its open body is mounted.
 * Returns `bodyMounted`: the body reports its mount state into it.
 */
export function useHunksOnDemand(options: {
  expanded: MaybeRefOrGetter<boolean>
  loaded: MaybeRefOrGetter<boolean>
  error: MaybeRefOrGetter<string | undefined>
  /**
   * The list entry the hunks are for. A new entry while a request is on the way keeps
   * `needed` true, so the watch must see the entry itself to ask again.
   */
  version: MaybeRefOrGetter<unknown>
  onNeeded: () => void
  /** Called when the card closes. A closed and opened card tries again after an error. */
  onCollapsed?: () => void
}) {
  const bodyMounted = ref(false)

  watch(
    () => toValue(options.expanded),
    expanded => {
      if (expanded) return
      bodyMounted.value = false
      options.onCollapsed?.()
    }
  )

  // Two sources, not one getter that returns an array: a new array on each run would
  // fire the callback on any change of the dependencies.
  watch(
    [
      () =>
        toValue(options.expanded) &&
        bodyMounted.value &&
        !toValue(options.loaded) &&
        !toValue(options.error),
      () => toValue(options.version)
    ],
    ([needed]) => {
      if (needed) options.onNeeded()
    },
    { immediate: true }
  )

  return { bodyMounted }
}
