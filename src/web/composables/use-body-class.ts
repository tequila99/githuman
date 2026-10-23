import { onScopeDispose, toValue, watch, type MaybeRefOrGetter } from 'vue'

export function useBodyClass(
  className: string,
  enabled: MaybeRefOrGetter<boolean>
) {
  watch(
    () => toValue(enabled),
    value => document.body.classList.toggle(className, value),
    { immediate: true }
  )
  onScopeDispose(() => document.body.classList.remove(className))
}
