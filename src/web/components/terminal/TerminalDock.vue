<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { format, useElementSize } from 'quasar'
import { useI18n } from 'vue-i18n'
import { useTerminalStore } from '@/stores/terminal-store'
import {
  useTerminalWindowGeometry,
  type PanEvent
} from '@/composables/use-terminal-window-geometry'

// A drag shorter than this is a click.
const DRAG_THRESHOLD = 4
// The default dock sits this far above the bottom of the viewport.
const BOTTOM_MARGIN = 16

const { between } = format
const store = useTerminalStore()
const { t } = useI18n()
const { viewport, position: windowPosition } = useTerminalWindowGeometry()
const dock = useTemplateRef('dock')
// The label length depends on the language, so the dock measures itself.
const { elementSize } = useElementSize({ target: () => dock.value?.$el })
const position = computed(() => {
  const { width, height } = elementSize.value
  const saved = store.dockPosition ?? {
    x: windowPosition.value.x,
    y: viewport.value.height - height - BOTTOM_MARGIN
  }
  return {
    x: between(saved.x, 0, Math.max(0, viewport.value.width - width)),
    y: between(saved.y, 0, Math.max(0, viewport.value.height - height))
  }
})
let dragStart = { x: 0, y: 0 }
let dragged = false

function drag(event: PanEvent): void {
  if (event.isFirst) {
    dragStart = { ...position.value }
    dragged = false
  }
  const offset = { x: event.offset?.x ?? 0, y: event.offset?.y ?? 0 }
  if (Math.abs(offset.x) + Math.abs(offset.y) > DRAG_THRESHOLD) dragged = true
  store.dockPosition = { x: dragStart.x + offset.x, y: dragStart.y + offset.y }
  // The browser sends a click after the drag. The flag must survive until that click.
  if (event.isFinal)
    setTimeout(() => {
      dragged = false
    }, 0)
}

function restore(): void {
  if (!dragged) store.show()
  dragged = false
}
</script>

<template>
  <q-btn
    ref="dock"
    v-touch-pan.prevent.mouse="drag"
    class="terminal-dock shadow-4"
    :style="{ left: `${position.x}px`, top: `${position.y}px` }"
    color="primary"
    icon="terminal"
    :label="t('terminal.title') + ' · ' + store.sessions.length"
    @click="restore"
  />
</template>

<style scoped>
.terminal-dock {
  position: fixed;
  z-index: var(--terminal-window-z);
  cursor: move;
  min-width: 180px;
}
</style>
