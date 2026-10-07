<script setup lang="ts">
import { ref, computed, defineAsyncComponent, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useKeyboardShortcut } from 'quasar'
import { useTerminalStore } from '@/stores/terminal-store'
import { useAppTheme } from '@/composables/use-app-theme'
import { useTerminalWindowGeometry } from '@/composables/use-terminal-window-geometry'
import TerminalWindowHeader from './TerminalWindowHeader.vue'
import TerminalTabs from './TerminalTabs.vue'
import TerminalLimitedBanner from './TerminalLimitedBanner.vue'
import TerminalResizeHandles from './TerminalResizeHandles.vue'
import TerminalDock from './TerminalDock.vue'
import TerminalCloseDialog from './TerminalCloseDialog.vue'

const TerminalView = defineAsyncComponent(() => import('./TerminalView.vue'))
const store = useTerminalStore()
const { t } = useI18n()
const { isDark } = useAppTheme()
const { style, drag } = useTerminalWindowGeometry()
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
  // The dock appears below the window until the user moves it.
  store.dockPosition = null
  store.minimize()
}
function toggleMaximized(): void {
  store.maximized = !store.maximized
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

useKeyboardShortcut(
  'Ctrl+Shift+Backquote',
  event => {
    event.stopPropagation()
    if (store.open && !store.minimized) {
      minimize()
    } else {
      store.show()
    }
  },
  () => ({ capture: true, disabled: !store.enabled || closeDialog.value })
)
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
  <div
    v-if="store.open && store.sessions.length"
    v-show="!store.minimized"
    class="terminal-window"
    :class="{ 'terminal-window--maximized': store.maximized }"
    :style="style"
    role="region"
    :aria-label="t('terminal.title')"
  >
    <!-- The frame clips the content to the rounded corners. The resize handles stay outside it. -->
    <div
      class="terminal-window__frame"
      :class="isDark ? 'bg-dark text-white' : 'bg-white text-dark'"
    >
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
      <TerminalTabs
        :sessions="store.sessions"
        :active-id="store.activeId"
        :busy="store.creating"
        :connected="connected"
        @activate="store.activate"
        @create="store.create"
        @request-close="requestClose"
      />
      <q-banner
        v-if="!connected"
        dense
        class="bg-grey-8 text-white text-caption"
      >
        {{ t('terminal.reconnecting') }}
      </q-banner>
      <q-banner
        v-if="store.error"
        dense
        class="bg-red-2 text-dark text-caption"
      >
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
          :active="store.activeId === session.id && !store.minimized"
          :dark="isDark"
          :original-colors="store.originalColors"
        />
      </div>
    </div>
    <TerminalResizeHandles v-if="!store.maximized" />
  </div>
  <TerminalDock v-if="store.open && store.minimized && store.sessions.length" />
  <TerminalCloseDialog
    v-model="closeDialog"
    :all="closeTarget === null"
    @confirm="confirmClose"
  />
</template>

<style scoped>
.terminal-window {
  position: fixed;
  z-index: var(--terminal-window-z);
  display: flex;
}
.terminal-window__frame {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--window-divider);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: var(--window-shadow);
}
/* A maximized window fills the viewport, so it needs no frame. */
.terminal-window--maximized .terminal-window__frame {
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.terminal-window__body {
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
}
</style>
