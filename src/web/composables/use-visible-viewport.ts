import { nextTick } from 'vue'
import { useEventListener } from 'quasar'
import { useViewportStore } from '@/stores/viewport-store'
import {
  viewportKeyboardOpen,
  nextViewportBaseline
} from '@/utils/visible-viewport'

export function useVisibleViewport() {
  const store = useViewportStore()
  let baseline = {
    width: window.innerWidth,
    height: window.innerHeight,
    layoutHeight: window.innerHeight
  }
  function update(event?: Event) {
    const viewport = window.visualViewport
    const current = {
      width: viewport?.width ?? window.innerWidth,
      height: viewport?.height ?? window.innerHeight,
      scale: viewport?.scale ?? 1,
      offsetTop: viewport?.offsetTop ?? 0,
      offsetLeft: viewport?.offsetLeft ?? 0
    }
    const editable =
      document.activeElement instanceof Element &&
      Boolean(
        document.activeElement.closest(
          'input:not([readonly]):not([disabled]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="file"]):not([type="range"]):not([type="color"]):not([type="hidden"]):not([type="reset"]), textarea:not([readonly]):not([disabled]), [contenteditable]:not([contenteditable="false"])'
        )
      )
    baseline = nextViewportBaseline(
      baseline,
      current,
      editable,
      window.innerHeight,
      event?.type === 'fullscreenchange'
    )
    store.keyboardOpen =
      Boolean(viewport) && viewportKeyboardOpen(baseline, current, editable)
    store.metrics = current
  }
  useEventListener(() => window.visualViewport ?? window, 'resize', update)
  useEventListener(() => window.visualViewport ?? window, 'scroll', update)
  // The layout viewport changes size too. Without `visualViewport` the first listener has it.
  useEventListener(
    () => (window.visualViewport ? window : null),
    'resize',
    update
  )
  useEventListener(document, 'fullscreenchange', update)
  useEventListener(document, 'focusin', update)
  useEventListener(document, 'focusout', () => {
    void nextTick().then(() => update())
  })
  update()
  return store
}
