import { computed, onScopeDispose, shallowRef } from 'vue'
import { useSegmentMount } from '@/composables/use-segment-mount'
import { observeScrollRootWidth } from '@/utils/scroll-root-width'

// A larger card margin gives loading and the inner row queue time to prepare.
export const CARD_MOUNT_MARGIN_PX = 6000
// Limits heavy card creation without changing the row queue's budgets.
const CARD_MOUNT_COST = 40

export interface CardShellOptions {
  minHeight: number
  owner: object
  version: string
  cacheHeight: boolean
  keep: boolean
}

/** The reserve is a navigation hint; the active card keeps its natural height. */
export function useCardShellMount(
  options: CardShellOptions,
  element: () => HTMLElement | null,
  findRoot: (element?: Element | null) => Element | null
) {
  // The provided root exists before virtual slots render, including on remount.
  const width = shallowRef(findRoot(element())?.clientWidth ?? 0)
  const version = computed(() => JSON.stringify([options.version, width.value]))
  const segment = useSegmentMount(
    {
      get minHeight() {
        return options.minHeight
      },
      get heightOwner() {
        return options.owner
      },
      heightKey: 'card-reserve',
      get heightVersion() {
        return version.value
      },
      get cacheHeight() {
        return options.cacheHeight
      },
      get keep() {
        return options.keep
      },
      cost: CARD_MOUNT_COST,
      mountMargin: CARD_MOUNT_MARGIN_PX
    },
    element
  )
  let stopWidth: (() => void) | undefined

  function start() {
    const root = findRoot(element())
    if (root) {
      width.value = root.clientWidth
      stopWidth = observeScrollRootWidth(root, () => {
        width.value = root.clientWidth
      })
    }
    segment.start(root)
  }
  function stop() {
    segment.stop()
    stopWidth?.()
    stopWidth = undefined
  }
  onScopeDispose(stop)
  return { mounted: segment.mounted, height: segment.height, start, stop }
}
