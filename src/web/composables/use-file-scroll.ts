import {
  nextTick,
  onScopeDispose,
  toValue,
  watch,
  type MaybeRefOrGetter
} from 'vue'
import type { ScrollRequest } from '@/stores/file-explorer-store'
import { followScrollTarget } from '@/utils/follow-scroll-target'

// Input in a visible pane releases the navigation anchor, including before list readiness.
const CANCEL_EVENTS = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const

export interface VirtualScrollApi {
  reset: () => void
  scrollTo: (index: number, edge?: 'start') => void
}

export function useFileScroll(options: {
  request: MaybeRefOrGetter<ScrollRequest | null>
  list: MaybeRefOrGetter<VirtualScrollApi | null>
  root: MaybeRefOrGetter<Element | null>
  ready?: MaybeRefOrGetter<boolean>
  inputTarget?: EventTarget | null
  target?: (request: ScrollRequest) => Element | null
  follow?: typeof followScrollTarget
}) {
  const inputTarget =
    options.inputTarget ?? (typeof document === 'undefined' ? null : document)
  const follow = options.follow ?? followScrollTarget
  let cancelledRequest: ScrollRequest | null = null
  let stopOperation: (() => void) | undefined
  function cancel() {
    if (options.ready !== undefined && !toValue(options.ready)) return
    cancelledRequest = toValue(options.request)
    stopOperation?.()
    stopOperation = undefined
  }
  for (const event of CANCEL_EVENTS) {
    inputTarget?.addEventListener(event, cancel, {
      capture: true,
      passive: true
    })
  }
  const stopWatch = watch(
    [
      () => toValue(options.request),
      () => toValue(options.list),
      () => toValue(options.root),
      () => options.ready === undefined || toValue(options.ready)
    ],
    ([request, list, root, ready], _previous, onCleanup) => {
      if (
        !request ||
        request === cancelledRequest ||
        !list ||
        !root ||
        !ready
      ) {
        return
      }
      let stopped = false
      let started = false
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
        if (
          toValue(options.request) === request &&
          (started ||
            toValue(options.list) !== list ||
            toValue(options.root) !== root)
        ) {
          cancelledRequest = request
        }
        if (stopOperation === stop) stopOperation = undefined
      })
      void nextTick().then(() => {
        if (
          stopped ||
          request === cancelledRequest ||
          (options.ready !== undefined && !toValue(options.ready))
        ) {
          return undefined
        }
        started = true
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
    for (const event of CANCEL_EVENTS) {
      inputTarget?.removeEventListener(event, cancel, true)
    }
  })
}
