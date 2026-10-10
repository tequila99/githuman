import { onBeforeUnmount, toValue, type MaybeRefOrGetter } from 'vue'
import {
  useTimeout,
  useEventListener,
  useTick,
  useAnimationFrame
} from 'quasar'
import type { PreviewTab } from '@/types/windows/preview'

// Avoid synchronous storage writes on every scroll event.
const SAVE_DELAY_MS = 200

interface PreviewScrollOptions {
  target: MaybeRefOrGetter<HTMLElement | null>
  tab: MaybeRefOrGetter<PreviewTab>
  remember: () => void
}

export function usePreviewScroll(options: PreviewScrollOptions) {
  const { registerTimeout, removeTimeout } = useTimeout()
  const { registerTick, removeTick } = useTick()
  const { registerAnimationFrame, removeAnimationFrame } = useAnimationFrame()
  let restoring = true

  function captureScroll() {
    const target = toValue(options.target)
    if (!target || restoring) return false
    const tab = toValue(options.tab)
    tab.scroll.x = target.scrollLeft
    tab.scroll.y = target.scrollTop
    return true
  }
  function rememberScroll() {
    if (captureScroll()) registerTimeout(options.remember, SAVE_DELAY_MS)
  }
  function prepareRestore() {
    restoring = true
    removeTick()
    removeAnimationFrame()
    removeTimeout()
  }
  function restoreScroll() {
    prepareRestore()
    registerTick(() => {
      const target = toValue(options.target)
      if (target) {
        const tab = toValue(options.tab)
        target.scrollLeft = tab.scroll.x
        target.scrollTop = tab.scroll.y
      }
      registerAnimationFrame(() => {
        restoring = false
      })
    })
  }
  function saveNow() {
    captureScroll()
    removeTimeout()
    options.remember()
  }
  useEventListener(() => window, 'pagehide', saveNow)
  onBeforeUnmount(saveNow)

  return { rememberScroll, prepareRestore, restoreScroll }
}
