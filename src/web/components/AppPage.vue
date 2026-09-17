<script setup lang="ts">
/**
 * Without this, <q-page> only gets a height via CSS flex/percentage sizing,
 * which QScrollArea's internal .q-scrollarea__container computes as 0px in
 * this browser — it still paints its absolutely-positioned content
 * correctly, but mouse events (e.g. scrolling gestures) fail to hit-test
 * into it. Every page with a full-height <q-scroll-area> needs this, so it
 * lives here once instead of being redeclared per page.
 */
function pageStyleFn(offset: number, height: number) {
  return { height: `${height - offset}px` }
}
</script>

<template>
  <q-page :style-fn="pageStyleFn">
    <slot />
  </q-page>
</template>
