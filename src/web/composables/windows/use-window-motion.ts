import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import { useEventListener, useTimeout } from 'quasar'
import {
  WINDOW_ANIMATION_DURATION_MS,
  WINDOW_ENTER_EASING,
  WINDOW_EXIT_EASING,
  WINDOW_IGNORE_REDUCED_MOTION,
  WINDOW_LAYOUT_EASING
} from '@/constants/windows/constants'
import { useWindowStore } from '@/stores/windows/window-store'
import type { WindowState } from '@/types/windows/window'
import { copyWindow, captureScroll } from '@/utils/windows/window-snapshot'
import {
  focusWindow,
  dockElement,
  isWindowGesture,
  registerWindowElement,
  trackWindowTransition
} from '@/utils/windows/window-elements'

// Allow setup time before cleaning up a stalled animation.
const CLEANUP_LIMIT_MS = WINDOW_ANIMATION_DURATION_MS + 750
// The dock button is much smaller than the window. The copy fades there to prevent an abrupt appearance or removal.
const DOCK_OPACITY = 0.2

export function useWindowMotion(
  id: string,
  state: WindowState,
  target: Ref<HTMLElement | null>
) {
  const store = useWindowStore()
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const { registerTimeout, removeTimeout } = useTimeout()
  function isReduced() {
    return reducedMotion.matches && !WINDOW_IGNORE_REDUCED_MOTION
  }
  let ready = false
  let generation = 0
  let finish: (() => void) | undefined
  let unregister: (() => void) | undefined
  watch(
    target,
    element => {
      unregister?.()
      unregister = element ? registerWindowElement(id, element) : undefined
    },
    { flush: 'post' }
  )
  onMounted(() => {
    ready = true
  })
  function stop() {
    finish?.()
  }
  useEventListener(document, 'visibilitychange', () => {
    if (document.hidden) stop()
  })
  useEventListener(window, 'resize', stop)
  useEventListener(reducedMotion, 'change', () => {
    if (isReduced()) stop()
  })
  watch(
    () => [state.open, state.minimized, state.mode] as const,
    (next, previous) => {
      stop()
      const current = ++generation
      const visible = next[0] && !next[1]
      const wasVisible = previous[0] && !previous[1]
      const anchor = dockElement(id)
      if (
        !ready ||
        isWindowGesture(id) ||
        document.hidden ||
        isReduced() ||
        !anchor ||
        (!visible && !wasVisible)
      )
        return
      const original = target.value
      const initialRect =
        wasVisible && original
          ? original.getBoundingClientRect()
          : anchor.getBoundingClientRect()
      let restoreScroll =
        wasVisible && original ? captureScroll(original) : undefined
      let copy: HTMLElement | null = null
      let layer: HTMLElement | null = null
      let animation: Animation | undefined
      let resolve!: () => void
      const transition = new Promise<void>(done => {
        resolve = done
      })
      let settled = false
      function cleanup() {
        if (settled) return
        settled = true
        animation?.cancel()
        layer?.remove()
        if (original) original.style.visibility = ''
        if (target.value) target.value.style.visibility = ''
        if (finish === cleanup) {
          finish = undefined
          removeTimeout()
        }
        resolve()
        if (visible && !wasVisible && store.isActive(id)) focusWindow(id)
      }
      finish = cleanup
      trackWindowTransition(id, transition)
      registerTimeout(cleanup, CLEANUP_LIMIT_MS)
      try {
        // Capture before Vue removes closed tabs or destroys a hidden PDF renderer.
        copy = wasVisible && original ? copyWindow(original) : null
        if (original) original.style.visibility = 'hidden'
        // A sync watcher can run before Vue queues the window render.
        void nextTick().then(async () => {
          await nextTick()
          if (settled || generation !== current) return undefined
          try {
            const element = target.value
            if (!copy && element) {
              copy = copyWindow(element)
              restoreScroll = captureScroll(element)
            }
            if (!copy || (visible && !element)) {
              cleanup()
              return undefined
            }
            const finalRect = visible
              ? element!.getBoundingClientRect()
              : anchor.getBoundingClientRect()
            const contentRect = wasVisible ? initialRect : finalRect
            if (
              !initialRect.width ||
              !initialRect.height ||
              !finalRect.width ||
              !finalRect.height
            ) {
              cleanup()
              return undefined
            }
            layer = document.createElement('div')
            layer.className = 'window-motion-layer'
            layer.inert = true
            layer.setAttribute('aria-hidden', 'true')
            Object.assign(layer.style, {
              position: 'fixed',
              pointerEvents: 'none',
              overflow: 'hidden',
              zIndex: String(
                element?.style.zIndex ?? original?.style.zIndex ?? 2500
              ),
              transformOrigin: '0 0'
            })
            Object.assign(copy.style, {
              position: 'absolute',
              left: '0',
              top: '0',
              width: `${contentRect.width}px`,
              height: `${contentRect.height}px`,
              visibility: 'visible',
              transformOrigin: '0 0',
              display: 'flex'
            })
            layer.append(copy)
            document.body.append(layer)
            restoreScroll?.(copy)
            if (element) element.style.visibility = 'hidden'
            Object.assign(layer.style, {
              left: '0',
              top: '0',
              width: `${contentRect.width}px`,
              height: `${contentRect.height}px`,
              overflow: 'visible',
              willChange: 'transform, opacity'
            })
            const transform = (rect: DOMRect) =>
              `translate(${rect.left}px, ${rect.top}px) scale(${rect.width / contentRect.width}, ${rect.height / contentRect.height})`
            layer.style.transform = transform(initialRect)
            // Animate one surface on the compositor to keep the snapshot content and geometry.
            animation = layer.animate(
              [
                {
                  transform: transform(initialRect),
                  opacity: wasVisible ? 1 : DOCK_OPACITY
                },
                {
                  transform: transform(finalRect),
                  opacity: visible ? 1 : DOCK_OPACITY
                }
              ],
              {
                duration: WINDOW_ANIMATION_DURATION_MS,
                easing: !wasVisible
                  ? WINDOW_ENTER_EASING
                  : visible
                    ? WINDOW_LAYOUT_EASING
                    : WINDOW_EXIT_EASING,
                fill: 'forwards'
              }
            )
            animation.addEventListener('finish', cleanup, { once: true })
            animation.addEventListener('cancel', cleanup, { once: true })
            return undefined
          } catch {
            cleanup()
            return undefined
          }
        })
      } catch {
        cleanup()
      }
    },
    { flush: 'sync' }
  )
  onBeforeUnmount(() => {
    generation++
    stop()
    unregister?.()
  })
}
