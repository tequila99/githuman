<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useScrollRoot } from '@/composables/use-scroll-root'

// How far outside the scroll window a segment mounts, in px. Rows far above the
// window unmount, but a quick scroll must not show an empty gap.
const ROOT_MARGIN_PX = 2000

const props = withDefaults(
  defineProps<{
    /** Height in px before the segment ever mounted. */
    minHeight: number
    /** Keeps the rows mounted outside the window, e.g. for an open comment form. */
    keep?: boolean
  }>(),
  { keep: false }
)

const emit = defineEmits<{
  /** The rows were mounted or unmounted. */
  (e: 'change', mounted: boolean): void
}>()

const findRoot = useScrollRoot()
const el = useTemplateRef<HTMLElement>('el')
// Without a scroll area to watch, the rows mount at once: no check, no gaps.
const mounted = ref(false)
// The last measured height holds the place of the rows while they are unmounted.
// Until the first measurement, the estimate from the parent holds the place.
const height = ref(props.minHeight)
let measured = false
let observer: IntersectionObserver | undefined

onMounted(() => {
  const root = el.value ? findRoot(el.value) : null
  if (!el.value || !root) {
    mounted.value = true
    return
  }
  observer = new IntersectionObserver(
    entries => {
      const latest = entries[entries.length - 1]
      if (!latest) return
      if (latest.isIntersecting) {
        mounted.value = true
      } else if (!props.keep) {
        // Measure only real rows: a placeholder has the estimated height.
        if (el.value && mounted.value) {
          height.value = el.value.offsetHeight
          measured = true
        }
        mounted.value = false
      }
    },
    { root, rootMargin: `${ROOT_MARGIN_PX}px 0px` }
  )
  observer.observe(el.value)
})

watch(mounted, value => emit('change', value))

// The estimate can grow, for example when the hunks of a card arrive.
watch(
  () => props.minHeight,
  value => {
    if (!measured) height.value = value
  }
)

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div ref="el" :style="mounted ? undefined : { height: `${height}px` }">
    <slot v-if="mounted" />
  </div>
</template>
