import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

export function useNoteLinkSuggestions(
  paths: MaybeRefOrGetter<readonly string[]>,
  query: MaybeRefOrGetter<string | null>
) {
  const active = ref(0)
  const matches = computed(() => {
    const needle = (toValue(query) ?? '').toLocaleLowerCase()
    return toValue(paths).filter(path =>
      path.toLocaleLowerCase().includes(needle)
    )
  })
  function reset() {
    active.value = 0
  }
  function move(step: number) {
    const length = matches.value.length
    active.value = length ? (active.value + step + length) % length : 0
  }
  watch(() => toValue(query), reset, { flush: 'sync' })
  watch(
    matches,
    items => {
      active.value = Math.min(active.value, Math.max(0, items.length - 1))
    },
    { flush: 'sync' }
  )
  return { matches, active, reset, move }
}
