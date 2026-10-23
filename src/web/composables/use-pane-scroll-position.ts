import { onScopeDispose, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useEventListener } from 'quasar'
import {
  followScrollTarget,
  offsetFromRootTop
} from '@/utils/follow-scroll-target'

export function usePaneScrollPosition(options: {
  active: MaybeRefOrGetter<boolean>
  ready: MaybeRefOrGetter<boolean>
  root: MaybeRefOrGetter<Element | null>
  request: MaybeRefOrGetter<unknown>
  /** Tests give their own follower. */
  follow?: typeof followScrollTarget
}) {
  const follow = options.follow ?? followScrollTarget
  let snapshot:
    | {
        root: Element
        path: string
        line: string | null
        offset: number
        request: unknown
      }
    | undefined
  let stopFollowing: (() => void) | undefined
  function stop() {
    stopFollowing?.()
    stopFollowing = undefined
  }
  function capture(replace = false) {
    if (snapshot && !replace) return
    const root = toValue(options.root)
    if (!root?.clientWidth || !root.clientHeight) return
    const top = root.getBoundingClientRect().top
    const target = [
      ...root.querySelectorAll<HTMLElement>('[data-file-path]')
    ].find(element => element.getBoundingClientRect().bottom > top)
    if (!target?.dataset.filePath) return
    const headerHeight =
      target.querySelector('.file-card-frame__header')?.getBoundingClientRect()
        .height ?? 0
    const line = [
      ...target.querySelectorAll<HTMLElement>('[data-line-key]')
    ].find(
      element => element.getBoundingClientRect().bottom > top + headerHeight
    )
    const anchor = line ?? target
    snapshot = {
      root,
      path: target.dataset.filePath,
      line: line?.getAttribute('data-line-key') ?? null,
      offset: offsetFromRootTop(root, anchor),
      request: toValue(options.request)
    }
  }
  watch(
    () => toValue(options.active),
    active => {
      if (!active) capture(true)
      stop()
    },
    { flush: 'sync' }
  )
  watch(() => toValue(options.request), stop, { flush: 'sync' })
  watch(
    () => toValue(options.root),
    () => {
      snapshot = undefined
      stop()
    },
    { flush: 'sync' }
  )
  watch(
    () => toValue(options.ready),
    ready => {
      stop()
      if (!ready || !toValue(options.active)) return
      const saved = snapshot
      snapshot = undefined
      if (
        !saved ||
        saved.root !== toValue(options.root) ||
        saved.request !== toValue(options.request)
      ) {
        return
      }
      stopFollowing = follow({
        root: saved.root,
        offset: saved.offset,
        target: () => {
          const card = [
            ...saved.root.querySelectorAll<HTMLElement>('[data-file-path]')
          ].find(element => element.dataset.filePath === saved.path)
          return saved.line
            ? ([
                ...(card?.querySelectorAll<HTMLElement>('[data-line-key]') ??
                  [])
              ].find(
                element => element.getAttribute('data-line-key') === saved.line
              ) ?? null)
            : (card ?? null)
        }
      })
    },
    { flush: 'post' }
  )
  useEventListener(
    // A getter: node tests have no `document`.
    () => (typeof document === 'undefined' ? null : document),
    ['wheel', 'pointerdown', 'touchstart', 'keydown'],
    stop,
    { capture: true, passive: true }
  )
  onScopeDispose(stop)
  return { capture }
}
