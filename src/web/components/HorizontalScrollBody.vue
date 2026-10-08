<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { equalArrays } from '@/utils/equal-arrays'

/**
 * A native (or QScrollArea) horizontal scrollbar sits at the element's
 * bottom — off-screen for a long file (#27). Hence a hidden-scrollbar
 * viewport plus a synced `position: sticky` bar.
 */

const props = defineProps<{
  /** Names the focusable scroll region for screen readers. */
  label?: string
  /**
   * A change of any item clears the measured content width: for example a new
   * version of the file, another view mode or wrap. Then the longest row can be shorter.
   */
  resetKey?: readonly unknown[]
}>()

const viewport = useTemplateRef<HTMLDivElement>('viewport')
const bar = useTemplateRef<HTMLDivElement>('bar')

const scrollWidth = ref(0)
const overflowing = ref(false)
// Width of the content box in px, or 0 for the window width. It only grows,
// so a segment that unmounts does not make the box narrower.
const contentWidth = ref(0)
let resetting = false
let active = true
let resetVersion = 0

/**
 * Reads scrollWidth itself: QResizeObserver only reports the viewport's
 * box, which new or longer lines don't change — v-mutation catches those.
 * Attributes aren't watched: token colors churn and never affect width. A
 * wrap toggle shows up as a height change (rows use overflow-wrap: anywhere).
 */
function measure() {
  const el = viewport.value
  if (!el || resetting || !active) return
  scrollWidth.value = el.scrollWidth
  overflowing.value = el.scrollWidth > el.clientWidth + 1
  if (overflowing.value && el.scrollWidth > contentWidth.value) {
    contentWidth.value = el.scrollWidth
  }
}

// The parent makes a new array on each render, so compare the items.
watch(
  () => props.resetKey ?? [],
  async (key, previous) => {
    if (equalArrays(key, previous)) return
    const version = ++resetVersion
    resetting = true
    contentWidth.value = 0
    // Read after the old CSS width is gone; mutation callbacks may arrive before it.
    await nextTick()
    if (!active || version !== resetVersion) return
    resetting = false
    measure()
    await nextTick()
    if (active && version === resetVersion)
      syncScroll(viewport.value, bar.value)
  }
)

// Post-flush: the bar must already have its new width and be visible.
watch([scrollWidth, overflowing], () => syncScroll(viewport.value, bar.value), {
  flush: 'post'
})

function syncScroll(from: HTMLDivElement | null, to: HTMLDivElement | null) {
  if (from && to && to.scrollLeft !== from.scrollLeft) {
    to.scrollLeft = from.scrollLeft
  }
}
onBeforeUnmount(() => {
  active = false
  resetVersion++
})
</script>

<template>
  <div class="horizontal-scroll-body">
    <div
      ref="viewport"
      v-mutation.childList.subtree.characterData="measure"
      class="horizontal-scroll-body__viewport"
      :tabindex="overflowing ? 0 : undefined"
      role="group"
      :aria-label="label"
      @scroll="syncScroll(viewport, bar)"
    >
      <div
        class="horizontal-scroll-body__content"
        :style="
          contentWidth ? { '--content-width': `${contentWidth}px` } : undefined
        "
      >
        <slot />
      </div>
      <q-resize-observer :debounce="0" @resize="measure" />
    </div>
    <div
      v-show="overflowing"
      ref="bar"
      class="horizontal-scroll-body__bar"
      aria-hidden="true"
      tabindex="-1"
      @scroll="syncScroll(bar, viewport)"
    >
      <div :style="{ width: `${scrollWidth}px`, height: '1px' }" />
    </div>
  </div>
</template>

<style scoped>
.horizontal-scroll-body {
  /* Stops long lines widening a shrink-to-fit ancestor (ReviewDetailPage). */
  contain: inline-size;
}

.horizontal-scroll-body__viewport {
  /* Explicit: a 'visible' overflow-y would be coerced to 'auto',
     nesting a second vertical scroller. */
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  /* 100cqi = the visible width, for content pinned in view (CommentThread). */
  container-type: inline-size;
}

/* One box as wide as the widest line: sticky content can only travel within
   its parent, so every hunk must span the whole scroll width (#38). The width
   comes from the measured scroll width, not from fit-content: fit-content
   measures every row again after each mount of a segment (ADR 0040). */
.horizontal-scroll-body__content {
  width: max(100%, var(--content-width, 0px));
}

.horizontal-scroll-body__viewport:focus-visible {
  /* Inset: FileCardFrame's overflow: clip cuts off an outside outline. */
  outline: 2px solid var(--q-primary);
  outline-offset: -2px;
}

.horizontal-scroll-body__viewport::-webkit-scrollbar {
  display: none;
}

.horizontal-scroll-body__bar {
  position: sticky;
  bottom: 0;
  z-index: 1;
  height: 12px;
  overflow-x: auto;
  overflow-y: hidden;
  background: var(--diff-header-bg);
  border-top: 1px solid rgba(128, 128, 128, 0.2);
}

/* Explicit styling keeps it visible with overlay scrollbars (macOS, GTK). */
.horizontal-scroll-body__bar::-webkit-scrollbar {
  height: 10px;
}

.horizontal-scroll-body__bar::-webkit-scrollbar-thumb {
  background: rgba(128, 128, 128, 0.5);
  border-radius: 5px;
}

@supports not selector(::-webkit-scrollbar) {
  .horizontal-scroll-body__bar {
    scrollbar-width: thin;
    scrollbar-color: rgba(128, 128, 128, 0.5) transparent;
  }
}
</style>
