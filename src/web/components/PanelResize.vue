<script setup lang="ts">
import { ref, computed } from 'vue'
import { clampWidth, readStoredWidth } from '@/composables/use-panel-width'
import { safeStorage } from '@/utils/safe-storage'

/** Where the file list width is remembered between page loads. */
const STORAGE_KEY = 'githuman.fileListWidth'
const DEFAULT_WIDTH = 260
const MIN_WIDTH = 220
const MAX_WIDTH = 600

const width = ref(
  readStoredWidth(STORAGE_KEY, MIN_WIDTH, MAX_WIDTH) ?? DEFAULT_WIDTH
)
const limits = computed(() => [MIN_WIDTH, MAX_WIDTH])

/**
 * `q-splitter` reports one value at the end of a drag, and a short drag can
 * report `undefined`. Check the value before it reaches the model.
 */
function onWidth(next: number | undefined) {
  if (typeof next !== 'number' || !Number.isFinite(next)) return
  width.value = clampWidth(next, MIN_WIDTH, MAX_WIDTH)
  safeStorage.set(STORAGE_KEY, String(width.value))
}
</script>

<template>
  <q-splitter
    :model-value="width"
    :limits
    unit="px"
    class="file-explorer"
    before-class="file-explorer__panel"
    after-class="file-explorer__content"
    @update:model-value="onWidth"
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
