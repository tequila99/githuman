<script setup lang="ts">
import {
  TERMINAL_WINDOW_ID,
  PREVIEW_WINDOW_ID
} from '@/constants/windows/constants'
import { computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWindowStore } from '@/stores/windows/window-store'
import { useTerminalStore } from '@/stores/terminal-store'
import { usePreviewStore } from '@/stores/windows/preview-store'
import { useApplicationRegistry } from '@/stores/windows/application-registry'
import { useServerEvents } from '@/composables/use-server-events'
import TerminalWindow from '@/components/terminal/TerminalWindow.vue'
import PreviewWindow from '@/components/preview/PreviewWindow.vue'
import WindowDock from './WindowDock.vue'

const { t } = useI18n()
const windows = useWindowStore()
const terminal = useTerminalStore()
const preview = usePreviewStore()
const registry = useApplicationRegistry()
const applications = computed(() => registry.applications)
const unregisterTerminal = registry.register({
  id: TERMINAL_WINDOW_ID,
  component: TerminalWindow,
  title: () => t('terminal.title'),
  icon: 'terminal',
  availability: () =>
    terminal.enabled
      ? { enabled: true }
      : { enabled: false, reason: t('terminal.unavailable') },
  badge: () => terminal.sessions.length || null,
  active: () => windows.isActive(TERMINAL_WINDOW_ID),
  activate: () => terminal.show()
})
const unregisterPreview = registry.register({
  id: PREVIEW_WINDOW_ID,
  component: PreviewWindow,
  title: () => t('windows.preview'),
  icon: 'visibility',
  availability: () => ({ enabled: true }),
  badge: () => preview.tabs.length || null,
  active: () => windows.isActive(PREVIEW_WINDOW_ID),
  activate: preview.show
})
const events = useServerEvents(['files:changed'], preview.invalidateFiles)
onBeforeUnmount(() => {
  events.close()
  unregisterTerminal()
  unregisterPreview()
})
</script>

<template>
  <template v-for="application in applications" :key="application.id">
    <component v-if="application.component" :is="application.component" />
  </template>
  <WindowDock :applications="applications" />
</template>
