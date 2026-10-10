<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import { useScrollRoot } from '@/composables/use-scroll-root'
import { useSegmentMount } from '@/composables/use-segment-mount'

const props = withDefaults(
  defineProps<{
    /** Height in px before the segment ever mounted. */
    minHeight: number
    /** Keeps the rows mounted outside the window, e.g. for an open comment form. */
    keep?: boolean
    /** Cost of the mount in rows for the mount queue. Unset: the estimated rows. */
    cost?: number | undefined
    /** Mounts at once and stays mounted: other code needs the content, such as a card body. */
    immediate?: boolean
    /**
     * False: the segment mounts when it comes near the window, without the mount
     * queue. For cheap content, such as a hunk whose rows are segments again.
     */
    queued?: boolean
    /** Object that owns the measured height (a hunk or a line array), with `heightKey`. */
    heightOwner?: object | undefined
    heightKey?: string | undefined
    /** Changes when the same segment has different geometry. */
    heightVersion?: string | undefined
    /** Only leaf code rows with fixed height can reuse external measurements. */
    cacheHeight?: boolean
    widthSensitive?: boolean
  }>(),
  {
    keep: false,
    cost: undefined,
    immediate: false,
    queued: true,
    heightOwner: undefined,
    heightKey: undefined,
    heightVersion: undefined,
    cacheHeight: false,
    widthSensitive: false
  }
)

const emit = defineEmits<{
  /** The rows were mounted or unmounted. */
  (e: 'change', mounted: boolean): void
}>()

const findRoot = useScrollRoot()
const el = useTemplateRef<HTMLElement>('el')
const { mounted, height, start, stop } = useSegmentMount(props, () => el.value)

onMounted(() => start(el.value ? findRoot(el.value) : null))
watch(mounted, value => emit('change', value))
onBeforeUnmount(stop)
</script>

<template>
  <div ref="el" :style="mounted ? undefined : { height: `${height}px` }">
    <slot v-if="mounted" />
  </div>
</template>
