<script setup lang="ts">
import AddButton from '@/components/buttons/AddButton.vue'
import {
  mdiArchiveOutline,
  mdiClipboardTextOutline,
  mdiCommentEditOutline,
  mdiConsoleLine,
  mdiEyeOutline,
  mdiFileDocumentOutline,
  mdiMonitorCellphone,
  mdiSwapHorizontal,
  mdiWeatherNight,
  mdiWhiteBalanceSunny
} from '@mdi/js'
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useAppTheme } from '@/composables/use-app-theme'
import { usePreviewStore } from '@/stores/windows/preview-store'
import { useTerminalStore } from '@/stores/terminal-store'
import { useAgentStore } from '@/stores/agent-store'
import { AGENT_ICON } from '@/utils/agent-icon'
import { NAV_BREAKPOINT } from '@/composables/use-nav-drawer'
import AgentChatStatusDot from '@/components/agent/AgentChatStatusDot.vue'
import DevicesDialog from '@/components/devices/DevicesDialog.vue'
import { useAccessStore } from '@/stores/access-store'
import { useAppInfoStore } from '@/stores/app-info-store'
import { useWorkspaceNavigation } from '@/composables/use-workspace-navigation'

const leftDrawerOpen = defineModel<boolean | null>({ required: true })

const { t } = useI18n()
const { narrow } = useWorkspaceNavigation()
const { isDark, toggleTheme } = useAppTheme()
const terminalStore = useTerminalStore()
const previewStore = usePreviewStore()
const agentStore = useAgentStore()
const { enabled: agentEnabled, activeId, panelOpen } = storeToRefs(agentStore)
const chatsOpen = ref(true)
const { isLocal } = storeToRefs(useAccessStore())
const devicesOpen = ref(false)
const { version } = storeToRefs(useAppInfoStore())
</script>

<template>
  <q-drawer
    :no-swipe-open="narrow"
    :no-swipe-close="narrow"
    :no-swipe-backdrop="narrow"
    v-model="leftDrawerOpen"
    :breakpoint="NAV_BREAKPOINT"
    bordered
    :width="220"
    :dark="isDark"
  >
    <div class="fit column no-wrap">
      <q-list class="col scroll">
        <q-item v-ripple clickable exact :to="{ path: '/' }">
          <q-item-section avatar>
            <q-icon class="app-icon-neutral" :name="mdiSwapHorizontal" />
          </q-item-section>
          <q-item-section>{{ t('nav.changes') }}</q-item-section>
        </q-item>

        <q-item v-ripple clickable :to="{ path: '/notes' }">
          <q-item-section avatar
            ><q-icon class="app-icon-neutral" :name="mdiFileDocumentOutline"
          /></q-item-section>
          <q-item-section>{{ t('notes.title') }}</q-item-section>
        </q-item>
        <q-item v-ripple clickable :to="{ path: '/tasks' }">
          <q-item-section avatar
            ><q-icon class="app-icon-neutral" :name="mdiClipboardTextOutline"
          /></q-item-section>
          <q-item-section>{{ t('tasks.title') }}</q-item-section>
        </q-item>
        <q-item v-ripple clickable :to="{ path: '/artifacts' }">
          <q-item-section avatar
            ><q-icon class="app-icon-neutral" :name="mdiArchiveOutline"
          /></q-item-section>
          <q-item-section>{{ t('artifacts.title') }}</q-item-section>
        </q-item>
        <q-item v-ripple clickable :to="{ path: '/reviews' }">
          <q-item-section avatar>
            <q-icon class="app-icon-neutral" :name="mdiCommentEditOutline" />
          </q-item-section>
          <q-item-section>{{ t('nav.reviews') }}</q-item-section>
        </q-item>

        <q-item
          v-if="terminalStore.enabled"
          v-ripple
          clickable
          @click="terminalStore.show"
        >
          <q-item-section avatar
            ><q-icon class="app-icon-neutral" :name="mdiConsoleLine"
          /></q-item-section>
          <q-item-section>{{ t('terminal.title') }}</q-item-section>
        </q-item>

        <q-item v-ripple clickable @click="previewStore.show">
          <q-item-section avatar
            ><q-icon class="app-icon-neutral" :name="mdiEyeOutline"
          /></q-item-section>
          <q-item-section>{{ t('windows.preview') }}</q-item-section>
        </q-item>

        <q-expansion-item
          v-if="agentEnabled"
          v-model="chatsOpen"
          expand-separator
          class="app-icon-expansion"
          expand-icon-class="app-icon-neutral"
        >
          <template #header>
            <q-item-section avatar>
              <q-icon class="app-icon-neutral" :name="AGENT_ICON" />
            </q-item-section>
            <q-item-section>{{ t('agent.chats.title') }}</q-item-section>
            <q-item-section v-if="agentStore.canAddChat" side>
              <AddButton
                size="sm"
                :tooltip="t('agent.chats.add')"
                @click.stop="agentStore.openNewChatDialog()"
              />
            </q-item-section>
          </template>

          <q-list dense class="agent-menu__chats">
            <q-item
              v-for="entry in agentStore.list"
              :key="entry.info.id"
              v-ripple
              clickable
              :active="panelOpen && entry.info.id === activeId"
              active-class="text-primary"
              @click="agentStore.openChat(entry.info.id)"
            >
              <q-item-section avatar class="agent-menu__dot">
                <AgentChatStatusDot :entry="entry" />
              </q-item-section>
              <q-item-section>
                <q-item-label lines="1">{{ entry.info.name }}</q-item-label>
              </q-item-section>
            </q-item>
            <q-item v-if="agentStore.list.length === 0" dense>
              <q-item-section class="text-caption text-grey-6">
                {{ t('agent.chats.empty') }}
              </q-item-section>
            </q-item>
          </q-list>
        </q-expansion-item>
      </q-list>

      <q-list bordered :dark="isDark">
        <q-item v-if="version" dense
          ><q-item-section class="text-caption"
            >{{ t('app.title') }} v{{ version }}</q-item-section
          ></q-item
        >
        <q-item v-if="isLocal" v-ripple clickable @click="devicesOpen = true">
          <q-item-section avatar
            ><q-icon class="app-icon-neutral" :name="mdiMonitorCellphone"
          /></q-item-section>
          <q-item-section>{{ t('devices.menu') }}</q-item-section>
        </q-item>
        <q-item v-ripple clickable @click="toggleTheme">
          <q-item-section avatar>
            <q-icon
              class="app-icon-neutral"
              :name="isDark ? mdiWhiteBalanceSunny : mdiWeatherNight"
            />
          </q-item-section>
          <q-item-section>
            {{ isDark ? t('theme.switchToLight') : t('theme.switchToDark') }}
          </q-item-section>
        </q-item>
      </q-list>
    </div>
    <DevicesDialog v-if="devicesOpen" @close="devicesOpen = false" />
  </q-drawer>
</template>

<style scoped>
.agent-menu__chats {
  padding: 4px 0 8px;
}
.agent-menu__dot {
  min-width: 28px;
  padding-left: 8px;
}
</style>
