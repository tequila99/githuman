import {
  nextTick,
  onScopeDispose,
  toValue,
  watch,
  type MaybeRefOrGetter
} from 'vue'
import type { ScrollRequest } from '@/stores/file-explorer-store'
import { followScrollHeader } from '@/utils/follow-scroll-header'

// Any deliberate input releases the navigation anchor, including before list readiness.
const CANCEL_EVENTS = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const

export interface VirtualScrollApi {
  reset: () => void
  scrollTo: (index: number, edge?: string) => void
}

export function useFileScroll(options: {
  request: MaybeRefOrGetter<ScrollRequest | null>
  list: MaybeRefOrGetter<VirtualScrollApi | null>
  root: MaybeRefOrGetter<Element | null>
  inputTarget?: EventTarget | null
  target?: (request: ScrollRequest) => Element | null
  follow?: typeof followScrollHeader
}) {
  const inputTarget =
    options.inputTarget ?? (typeof document === 'undefined' ? null : document)
  const follow = options.follow ?? followScrollHeader
  let cancelledRequest: ScrollRequest | null = null
  let stopOperation: (() => void) | undefined
  function cancel() {
    cancelledRequest = toValue(options.request)
    stopOperation?.()
    stopOperation = undefined
  }
  for (const event of CANCEL_EVENTS)
    inputTarget?.addEventListener(event, cancel, {
      capture: true,
      passive: true
    })
  const stopWatch = watch(
    [
      () => toValue(options.request),
      () => toValue(options.list),
      () => toValue(options.root)
    ],
    ([request, list, root], _previous, onCleanup) => {
      if (!request || request === cancelledRequest || !list || !root) return
      let stopped = false
      let stopFollowing: (() => void) | undefined
      const stop = () => {
        stopped = true
        stopFollowing?.()
        stopFollowing = undefined
      }
      stopOperation = stop
      onCleanup(() => {
        stop()
        // A changed list or root must not resume this request when it returns.
        if (toValue(options.request) === request) cancelledRequest = request
        if (stopOperation === stop) stopOperation = undefined
      })
      void nextTick().then(() => {
        if (stopped || request === cancelledRequest) return undefined
        list.scrollTo(request.index, 'start')
        stopFollowing = follow({
          root,
          // The card, not its sticky header: that header stays at the top of the
          // scroll window while its card scrolls (#77).
          target: () =>
            options.target
              ? options.target(request)
              : document.getElementById(`diff-file-${request.path}`)
        })
        return undefined
      })
    },
    { immediate: true, flush: 'post' }
  )
  onScopeDispose(() => {
    stopWatch()
    stopOperation?.()
    for (const event of CANCEL_EVENTS)
      inputTarget?.removeEventListener(event, cancel, true)
  })
}
