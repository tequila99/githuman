import { toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useTimeout } from 'quasar'
import { enhanceMermaidBlocks } from '@/utils/mermaid-blocks'

export function useMermaidBlocks(
  target: MaybeRefOrGetter<HTMLElement | null>,
  html: MaybeRefOrGetter<string>,
  dark: MaybeRefOrGetter<boolean>,
  failedLabel: MaybeRefOrGetter<string>,
  debounce: MaybeRefOrGetter<number> = 0
) {
  const { registerTimeout, removeTimeout } = useTimeout()
  watch(
    () =>
      [
        toValue(target),
        toValue(html),
        toValue(dark),
        toValue(failedLabel),
        toValue(debounce)
      ] as const,
    ([root, markup, isDark, label, delay], _previous, onCleanup) => {
      removeTimeout()
      let current = true
      onCleanup(() => {
        current = false
        removeTimeout()
      })
      if (
        !root ||
        (!markup.includes('language-mermaid') &&
          !root.querySelector('.agent-mermaid'))
      )
        return
      registerTimeout(() => {
        void enhanceMermaidBlocks(
          root,
          isDark,
          undefined,
          label,
          () =>
            current &&
            toValue(target) === root &&
            toValue(html) === markup &&
            toValue(dark) === isDark
        )
      }, delay)
    },
    { flush: 'post', immediate: true }
  )
}
