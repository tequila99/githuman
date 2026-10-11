<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { useWindowMotion } from '@/composables/windows/use-window-motion'
import { useWindowStore } from '@/stores/windows/window-store'
import { useWindowGeometry } from '@/composables/windows/use-window-geometry'
import WindowResizeHandles from './WindowResizeHandles.vue'

const props = defineProps<{
  windowId: string
  title: string
  minimum?: { width: number; height: number } | undefined
}>()
const windows = useWindowStore()
const { state, style } = useWindowGeometry(props.windowId)
const element = useTemplateRef<HTMLElement>('window')
useWindowMotion(props.windowId, state, element)
</script>

<template>
  <section
    ref="window"
    tabindex="-1"
    :data-window-id="windowId"
    v-if="state.open"
    v-show="!state.minimized"
    class="floating-window"
    :class="{ 'floating-window--maximized': state.maximized }"
    :style="style"
    :aria-label="title"
    @pointerdown.capture="windows.focus(windowId)"
    @focusin="windows.focus(windowId)"
  >
    <div
      class="floating-window__frame"
      :class="$q.dark.isActive ? 'bg-dark text-white' : 'bg-white text-dark'"
    >
      <slot name="header" />
      <div class="floating-window__body"><slot /></div>
    </div>
    <WindowResizeHandles
      v-if="!state.maximized"
      :window-id="windowId"
      :minimum="minimum"
    />
  </section>
</template>

<style scoped>
.floating-window {
  position: fixed;
  display: flex;
}
.floating-window__frame {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--window-divider);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: var(--window-shadow);
}
.floating-window--maximized .floating-window__frame {
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.floating-window__body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
