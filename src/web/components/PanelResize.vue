<script setup lang="ts">
import { ref, computed } from 'vue'
import { clampWidth, readStoredWidth } from '@/composables/use-panel-width'
import { isFiniteNumber } from '@/utils/guards'
import { safeStorage } from '@/utils/safe-storage'
import { useWorkspaceNavigation } from '@/composables/use-workspace-navigation'
import WorkspacePane from './WorkspacePane.vue'

/** Narrowest and widest panel the user can drag to, in pixels. */
const MIN_WIDTH = 220
const MAX_WIDTH = 600

const props = withDefaults(
  defineProps<{
    /** Where the width is remembered between page loads. */
    storageKey?: string
    defaultWidth?: number
  }>(),
  { storageKey: 'githuman.fileListWidth', defaultWidth: 260 }
)

const width = ref(
  readStoredWidth(props.storageKey, MIN_WIDTH, MAX_WIDTH) ?? props.defaultWidth
)
const limits = computed(() => [MIN_WIDTH, MAX_WIDTH])
const { narrow, pane, window: activeWindow } = useWorkspaceNavigation()
// A side is active on desktop, or when it is the narrow pane and no window covers it.
const listActive = computed(
  () => !narrow.value || (pane.value === 'list' && !activeWindow.value)
)
const contentActive = computed(
  () => !narrow.value || (pane.value === 'content' && !activeWindow.value)
)

/**
 * `q-splitter` reports one value at the end of a drag, and a short drag can
 * report `undefined`. Check the value before it reaches the model.
 */
function onWidth(next: number | undefined) {
  if (narrow.value) return
  if (!isFiniteNumber(next)) return
  width.value = clampWidth(next, MIN_WIDTH, MAX_WIDTH)
  safeStorage.set(props.storageKey, String(width.value))
}
</script>

<template>
  <q-splitter
    :model-value="width"
    :limits
    unit="px"
    class="file-explorer"
    :class="{ 'file-explorer--narrow': narrow }"
    :disable="narrow"
    :before-class="[
      'file-explorer__panel',
      { 'workspace-pane--hidden': narrow && pane !== 'list' }
    ]"
    :after-class="[
      'file-explorer__content',
      { 'workspace-pane--hidden': narrow && pane !== 'content' }
    ]"
    @update:model-value="onWidth"
  >
    <template #before>
      <WorkspacePane :active="listActive">
        <slot name="panel" />
      </WorkspacePane>
    </template>
    <template #after>
      <WorkspacePane :active="contentActive">
        <slot name="content" />
      </WorkspacePane>
    </template>
  </q-splitter>
</template>

<style scoped>
.file-explorer {
  height: 100%;
  min-height: 0;
}

.file-explorer--narrow :deep(.q-splitter__before),
.file-explorer--narrow :deep(.q-splitter__after) {
  position: absolute;
  inset: 0;
  width: 100% !important;
  height: 100%;
}
.file-explorer--narrow :deep(.q-splitter__separator) {
  display: none;
}
:deep(.workspace-pane--hidden) {
  visibility: hidden;
  pointer-events: none;
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
