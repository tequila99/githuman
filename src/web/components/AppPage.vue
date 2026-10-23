<script setup lang="ts">
import { useViewportStore } from '@/stores/viewport-store'
const viewport = useViewportStore()
/**
 * Without this, <q-page> only gets a height via CSS flex/percentage sizing,
 * which QScrollArea's internal .q-scrollarea__container computes as 0px in
 * this browser — it still paints its absolutely-positioned content
 * correctly, but mouse events (e.g. scrolling gestures) fail to hit-test
 * into it. Every page with a full-height <q-scroll-area> needs this, so it
 * lives here once instead of being redeclared per page.
 */
function pageStyleFn(offset: number, height: number) {
  const visibleHeight =
    viewport.metrics.scale === 1 && viewport.metrics.height > 0
      ? Math.min(height, viewport.metrics.height)
      : height
  return {
    height: `${Math.max(0, visibleHeight - offset)}px`,
    minHeight: '0px'
  }
}
</script>

<template>
  <q-page :style-fn="pageStyleFn">
    <slot />
  </q-page>
</template>
