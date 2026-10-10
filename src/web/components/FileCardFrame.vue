<script setup lang="ts">
defineProps<{
  /** The header stays at the top of the scroll window while the card scrolls (#77). */
  stickyHeader?: boolean
}>()
</script>

<template>
  <div class="file-card-frame">
    <div
      class="file-card-frame__header"
      :class="{ 'file-card-frame__header--sticky': stickyHeader }"
    >
      <slot name="header" />
    </div>
    <slot />
  </div>
</template>

<style scoped>
.file-card-frame {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 4px;
  /* clip, not hidden: 'hidden' makes this a scroll container, which would
     pin HorizontalScrollBody's sticky scrollbar to the card instead of the
     page's <q-scroll-area>. */
  overflow: clip;
}

.file-card-frame__header {
  flex: none;
}

/* The frame is the containing block, so the header stops at the end of its card.
   z-index 2 keeps it above the sticky bar of HorizontalScrollBody (z-index 1). */
.file-card-frame__header--sticky {
  position: sticky;
  top: 0;
  z-index: 2;
}
</style>
