<script setup lang="ts">
import { TERMINAL_WINDOW_ID } from '@/constants/windows/constants'
import { ref, computed, defineAsyncComponent, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppTheme } from '@/composables/use-app-theme'
import { useWindowStore } from '@/stores/windows/window-store'
import { useTerminalStore } from '@/stores/terminal-store'
import { useWindowCloseShortcut } from '@/composables/windows/use-window-shortcuts'
import { useWindowGeometry } from '@/composables/windows/use-window-geometry'
import TerminalWindowHeader from './TerminalWindowHeader.vue'
import TerminalTabs from './TerminalTabs.vue'
import TerminalLimitedBanner from './TerminalLimitedBanner.vue'
import FloatingWindow from '@/components/windows/FloatingWindow.vue'
import TerminalCloseDialog from './TerminalCloseDialog.vue'

const TerminalView = defineAsyncComponent(() => import('./TerminalView.vue'))
const store = useTerminalStore()
const windows = useWindowStore()
const { isDark } = useAppTheme()
const { t } = useI18n()
const { drag } = useWindowGeometry(TERMINAL_WINDOW_ID)
const connected = computed(() => store.state === 'connected')
const activeSession = computed(() =>
  store.sessions.find(session => session.id === store.activeId)
)
// A local error has an i18n key. A server or network error brings its own text.
const errorText = computed(() => {
  const error = store.error
  if (!error) return ''
  return 'key' in error ? t(`terminal.${error.key}`) : error.text
})
const closeDialog = ref(false)
// The session that the dialog closes. The value null means all sessions.
const closeTarget = ref<string | null>(null)

function minimize(): void {
  store.minimize()
}
function toggleMaximized(): void {
  windows.toggleMode(TERMINAL_WINDOW_ID, 'maximized')
}
function requestClose(id: string | null): void {
  closeTarget.value = id
  closeDialog.value = true
}
function confirmClose(): void {
  if (closeTarget.value === null) {
    for (const session of store.sessions) store.close(session.id)
  } else {
    store.close(closeTarget.value)
  }
}

useWindowCloseShortcut(TERMINAL_WINDOW_ID, () => {
  requestClose(store.sessions.length > 1 ? store.activeId : null)
})

// The dialog has nothing to close when its session or every session is gone.
watch(
  () => store.sessions,
  sessions => {
    const target = closeTarget.value
    if (!sessions.length || (target && !sessions.some(s => s.id === target)))
      closeDialog.value = false
  }
)
</script>

<template>
  <FloatingWindow :window-id="TERMINAL_WINDOW_ID" :title="t('terminal.title')">
    <template #header>
      <TerminalWindowHeader
        :maximized="store.maximized"
        :connected="connected"
        :original-colors="store.originalColors"
        @drag="drag"
        @toggle-original-colors="store.originalColors = !store.originalColors"
        @minimize="minimize"
        @toggle-maximized="toggleMaximized"
        @close-all="requestClose(null)"
      />
    </template>
    <TerminalTabs
      :sessions="store.sessions"
      :active-id="store.activeId"
      :busy="store.creating"
      :connected="connected"
      @activate="store.activate"
      @create="store.create"
      @request-close="requestClose"
    />
    <q-banner v-if="!connected" dense class="bg-grey-8 text-white text-caption">
      {{ t('terminal.reconnecting') }}
    </q-banner>
    <q-banner v-if="store.error" dense class="bg-red-2 text-dark text-caption">
      {{ errorText }}
      <template #action>
        <q-btn flat dense icon="close" @click="store.error = null" />
      </template>
    </q-banner>
    <TerminalLimitedBanner v-if="activeSession?.mode === 'pipe'" />
    <div class="terminal-window__body">
      <TerminalView
        v-for="session in store.sessions"
        v-show="store.activeId === session.id"
        :key="session.id"
        :session="session"
        :active="
          store.activeId === session.id && windows.isActive(TERMINAL_WINDOW_ID)
        "
        :dark="isDark"
        :original-colors="store.originalColors"
      />
    </div>
  </FloatingWindow>
  <TerminalCloseDialog
    v-model="closeDialog"
    :all="closeTarget === null"
    @confirm="confirmClose"
  />
</template>

<style scoped>
.terminal-window__body {
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
}
</style>
