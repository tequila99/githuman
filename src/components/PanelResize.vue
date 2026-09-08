<script setup lang="ts">
import { ref, computed } from 'vue'

const DEFAULT_WIDTH = 260
const MIN_WIDTH = 220
const MAX_WIDTH = 600

const width = ref(DEFAULT_WIDTH)
const limits = computed(() => [MIN_WIDTH, MAX_WIDTH])
</script>

<template>
  <q-splitter
    v-model="width"
    :limits
    unit="px"
    class="file-explorer"
    before-class="file-explorer__panel"
    after-class="file-explorer__content"
  >
    <template #before>
      <slot name="panel" />
    </template>
    <template #after>
      <slot name="content" />
    </template>
  </q-splitter>
</template>

<style scoped>
.file-explorer {
  height: 100%;
}

:deep(.file-explorer__panel) {
  flex-shrink: 0;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

:deep(.file-explorer__content) {
  display: flex;
  flex-direction: column;
  flex-wrap: no-wrap;
}
</style>
