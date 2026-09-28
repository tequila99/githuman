<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'

/**
 * Horizontal scroll container whose scrollbar stays visible at the bottom of
 * the page's scroll area while any part of it is on screen (#27). A plain
 * `overflow-x: auto` draws its scrollbar at the very bottom of the element —
 * for a file longer than the screen that's out of view until you reach the
 * end of the file. So the content scrolls in a viewport with its native
 * scrollbar hidden, and a separate `position: sticky` bar of the same scroll
 * width is kept in sync with it. Shift+wheel works natively on either.
 */

const viewport = useTemplateRef<HTMLDivElement>('viewport')
const bar = useTemplateRef<HTMLDivElement>('bar')

const scrollWidth = ref(0)
const overflowing = ref(false)

function measure() {
  const el = viewport.value
  if (!el) return
  scrollWidth.value = el.scrollWidth
  overflowing.value = el.scrollWidth > el.clientWidth + 1
}

// After the DOM update, so the bar already has its new spacer width and is
// no longer display:none when its scrollLeft is set.
watch([scrollWidth, overflowing], () => syncScroll(viewport.value, bar.value), {
  flush: 'post'
})

// A ResizeObserver alone misses scrollWidth changes that don't change the
// viewport's own box (new/longer lines, diff/full-file switch) — hence the
// MutationObserver too. 'style' is deliberately not watched: token colors
// change on every theme switch/highlight pass and never affect width.
let frame = 0
function scheduleMeasure() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    measure()
  })
}

let resizeObserver: ResizeObserver | null = null
let mutationObserver: MutationObserver | null = null

onMounted(() => {
  if (!viewport.value) return
  resizeObserver = new ResizeObserver(scheduleMeasure)
  resizeObserver.observe(viewport.value)
  mutationObserver = new MutationObserver(scheduleMeasure)
  mutationObserver.observe(viewport.value, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class']
  })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
  cancelAnimationFrame(frame)
})

function syncScroll(from: HTMLDivElement | null, to: HTMLDivElement | null) {
  if (from && to && to.scrollLeft !== from.scrollLeft) {
    to.scrollLeft = from.scrollLeft
  }
}
</script>

<template>
  <div class="horizontal-scroll-body">
    <div
      ref="viewport"
      class="horizontal-scroll-body__viewport"
      :tabindex="overflowing ? 0 : undefined"
      @scroll="syncScroll(viewport, bar)"
    >
      <slot />
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
  /* Keeps long lines (and the bar's full-width spacer) from widening a
     shrink-to-fit ancestor, e.g. the q-scroll-area content box on
     ReviewDetailPage — the overflow has to land here, not in the page. */
  contain: inline-size;
}

.horizontal-scroll-body__viewport {
  /* overflow-y must be set explicitly alongside overflow-x (not left at its
     'visible' default) — otherwise the UA auto-coerces it to 'auto' too
     (CSS Overflow §3), creating a second vertical scroll container nested
     inside the page's own <q-scroll-area>. */
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
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

/* Styled explicitly so it stays visible on platforms with overlay
   scrollbars (macOS, GTK) instead of only appearing mid-scroll. */
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
