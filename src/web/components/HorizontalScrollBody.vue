<script setup lang="ts">
import { ref, useTemplateRef, watch } from 'vue'

/**
 * Horizontal scroll container whose scrollbar stays visible at the bottom of
 * the page's scroll area while any part of it is on screen (#27). A plain
 * `overflow-x: auto` draws its scrollbar at the very bottom of the element —
 * for a file longer than the screen that's out of view until you reach the
 * end of the file. QScrollArea has the same limitation (its bars are
 * absolute-bottom of the area, which also needs a fixed height). So the
 * content scrolls in a viewport with its native scrollbar hidden, and a
 * separate `position: sticky` bar of the same scroll width is kept in sync
 * with it. Shift+wheel works natively on either.
 */

defineProps<{
  /** Accessible name for the focusable scroll region, e.g. the file path. */
  label?: string
}>()

const viewport = useTemplateRef<HTMLDivElement>('viewport')
const bar = useTemplateRef<HTMLDivElement>('bar')

const scrollWidth = ref(0)
const overflowing = ref(false)

/**
 * Called by QResizeObserver (the viewport's own box changed: width, or
 * height when wrap is toggled — overflowing lines re-wrap thanks to
 * `overflow-wrap: anywhere` in DiffLineRow/FileContentLine, which is what
 * makes a wrap toggle visible here) and by v-mutation (new/longer lines,
 * diff/full-file switch, late syntax highlighting — scrollWidth changes the
 * viewport's box doesn't show). Attributes are deliberately not watched:
 * token colors change on every theme switch/highlight pass and never affect
 * width, and v-mutation has no attribute filter.
 */
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
      v-mutation.childList.subtree.characterData="measure"
      class="horizontal-scroll-body__viewport"
      :tabindex="overflowing ? 0 : undefined"
      role="group"
      :aria-label="label"
      @scroll="syncScroll(viewport, bar)"
    >
      <slot />
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

.horizontal-scroll-body__viewport:focus-visible {
  /* Inset: FileCardFrame's overflow: clip would cut off an outside outline. */
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
