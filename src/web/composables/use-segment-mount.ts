import { onScopeDispose, readonly, ref, watch } from 'vue'
import { queueMount, type MountJob } from '@/utils/mount-queue'
import { observeSegment } from '@/utils/segment-observer'
import { observeScrollRootWidth } from '@/utils/scroll-root-width'
import { rememberSegmentHeight, segmentHeight } from '@/utils/segment-heights'
import { ROW_HEIGHT } from '@/utils/row-segments'

export interface SegmentMountOptions {
  /** Fixed for this subscription: cards prepare earlier than row segments. */
  mountMargin?: number
  minHeight: number
  keep?: boolean
  cost?: number | undefined
  immediate?: boolean
  queued?: boolean
  heightOwner?: object | undefined
  heightKey?: string | undefined
  heightVersion?: string | undefined
  cacheHeight?: boolean
  widthSensitive?: boolean
}

/** Explicit start/stop keeps DOM subscriptions separate from reactive state. */
export function useSegmentMount(
  options: SegmentMountOptions,
  element: () => HTMLElement | null
) {
  const mounted = ref(false)
  const height = ref(options.minHeight)
  let measured = false
  let active = false
  let alwaysMounted = false
  let near = false
  let visible = false
  let job: MountJob | undefined
  let stopPosition: (() => void) | undefined
  let stopWidth: (() => void) | undefined

  function cachedHeight(): number | undefined {
    return options.cacheHeight &&
      options.heightOwner &&
      options.heightKey !== undefined
      ? segmentHeight(
          options.heightOwner,
          options.heightKey,
          options.heightVersion ?? ''
        )
      : undefined
  }

  function resetHeight() {
    const cached = cachedHeight()
    measured = cached !== undefined
    height.value = cached ?? options.minHeight
  }

  function measure() {
    const el = element()
    if (!mounted.value || !el) return
    height.value = el.offsetHeight
    measured = true
    if (
      options.cacheHeight &&
      options.heightOwner &&
      options.heightKey !== undefined
    ) {
      rememberSegmentHeight(
        options.heightOwner,
        options.heightKey,
        options.heightVersion ?? '',
        height.value
      )
    }
  }

  function cancelJob() {
    job?.cancel()
    job = undefined
  }

  function requestMount() {
    if (!active || !near || mounted.value || job) return
    if (options.queued === false) {
      mounted.value = true
      return
    }
    job = queueMount(
      options.cost ?? Math.ceil(height.value / ROW_HEIGHT),
      () => {
        job = undefined
        mounted.value = true
      },
      visible
    )
  }

  function invalidate() {
    resetHeight()
    cancelJob()
    requestMount()
  }

  function start(root: Element | null) {
    if (active) return
    active = true
    const el = element()
    if (options.immediate || !el || !root) {
      alwaysMounted = true
      mounted.value = true
      return
    }
    // The placeholder remains observed after cancellation, so it can enter again.
    stopPosition = observeSegment(
      root,
      el,
      {
        near: value => {
          near = value
          if (near) {
            requestMount()
          } else {
            cancelJob()
            if (options.keep) return
            measure()
            mounted.value = false
          }
        },
        visible: value => {
          visible = value
          job?.setVisible(value)
        }
      },
      options.mountMargin
    )
    stopWidth = observeScrollRootWidth(root, () => {
      if (options.widthSensitive) invalidate()
    })
  }

  function stop() {
    if (!active) return
    // Only persisted measurements can outlive a destroyed segment.
    if (
      options.cacheHeight &&
      options.heightOwner &&
      options.heightKey !== undefined
    )
      measure()
    active = false
    cancelJob()
    stopPosition?.()
    stopWidth?.()
    stopPosition = undefined
    stopWidth = undefined
  }

  resetHeight()
  watch(
    [
      () => options.heightOwner,
      () => options.heightKey,
      () => options.heightVersion,
      () => options.cacheHeight,
      () => options.widthSensitive,
      () => options.minHeight,
      () => options.cost,
      () => options.keep
    ],
    (current, previous) => {
      const changed = current
        .slice(0, 5)
        .some((value, index) => value !== previous[index])
      if (changed) {
        resetHeight()
      } else if (!measured) {
        height.value = options.minHeight
      }
      if (changed || current[5] !== previous[5] || current[6] !== previous[6]) {
        cancelJob()
        requestMount()
      }
      if (active && !alwaysMounted && !near && !options.keep && mounted.value) {
        measure()
        mounted.value = false
      }
    },
    { flush: 'post' }
  )
  onScopeDispose(stop)

  return { mounted: readonly(mounted), height: readonly(height), start, stop }
}
