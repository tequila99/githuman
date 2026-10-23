<script setup lang="ts">
import { useTemplateRef, ref, watch } from 'vue'
import { useWindowMotion } from '@/composables/windows/use-window-motion'
import { useWindowStore } from '@/stores/windows/window-store'
import { useWindowGeometry } from '@/composables/windows/use-window-geometry'
import WindowResizeHandles from './WindowResizeHandles.vue'
import { useWorkspaceNavigation } from '@/composables/use-workspace-navigation'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  windowId: string
  title: string
  minimum?: { width: number; height: number } | undefined
}>()
const windows = useWindowStore()
const workspace = useWorkspaceNavigation()
const visited = ref(false)
const { t } = useI18n()
const { state, style } = useWindowGeometry(props.windowId)
// A window shown from history keeps its content while it is open. A closed and hidden
// window unmounts, so its content does not stay in the DOM until a reload.
watch(
  () => [workspace.window.value === props.windowId, state.open] as const,
  ([shown, open]) => {
    if (shown) {
      visited.value = true
    } else if (!open) {
      visited.value = false
    }
  },
  { immediate: true }
)
const element = useTemplateRef<HTMLElement>('window')
useWindowMotion(props.windowId, state, element)
</script>

<template>
  <section
    ref="window"
    tabindex="-1"
    :data-window-id="windowId"
    v-if="state.open || visited"
    v-show="
      workspace.narrow.value
        ? workspace.window.value === windowId
        : state.open && !state.minimized
    "
    class="floating-window"
    :class="{
      'floating-window--maximized': state.maximized || workspace.narrow.value,
      'floating-window--narrow': workspace.narrow.value
    }"
    :style="style"
    :aria-label="title"
    @pointerdown.capture="!workspace.narrow.value && windows.focus(windowId)"
    @focusin="!workspace.narrow.value && windows.focus(windowId)"
  >
    <div
      class="floating-window__frame"
      :class="$q.dark.isActive ? 'bg-dark text-white' : 'bg-white text-dark'"
    >
      <div
        v-if="workspace.narrow.value"
        class="row items-center no-wrap q-px-sm"
      >
        <q-btn
          flat
          round
          icon="arrow_back"
          :aria-label="t('workspace.back')"
          @click="workspace.back"
        />
        <span class="ellipsis">{{ title }}</span>
      </div>
      <slot name="header" />
      <div class="floating-window__body"><slot /></div>
    </div>
    <WindowResizeHandles
      v-if="!state.maximized && !workspace.narrow.value"
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
.floating-window--narrow {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}
</style>
