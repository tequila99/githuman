<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useAppTheme } from '@/composables/use-app-theme'
import { useAgentStore } from '@/stores/agent-store'
import { AGENT_ICON } from '@/utils/agent-icon'
import { NAV_BREAKPOINT } from '@/composables/use-nav-drawer'
import AgentChatStatusDot from '@/components/agent/AgentChatStatusDot.vue'

const leftDrawerOpen = defineModel<boolean | null>({ required: true })

const { t } = useI18n()
const { isDark, toggleTheme } = useAppTheme()
const agentStore = useAgentStore()
const { enabled: agentEnabled, activeId, panelOpen } = storeToRefs(agentStore)
const chatsOpen = ref(true)
</script>

<template>
  <q-drawer
    v-model="leftDrawerOpen"
    :breakpoint="NAV_BREAKPOINT"
    bordered
    :width="220"
    :dark="isDark"
  >
    <div class="fit column no-wrap">
      <q-list class="col scroll">
        <q-item v-ripple clickable :to="{ path: '/' }">
          <q-item-section avatar>
            <q-icon name="compare_arrows" />
          </q-item-section>
          <q-item-section>{{ t('nav.changes') }}</q-item-section>
        </q-item>

        <q-item v-ripple clickable :to="{ path: '/reviews' }">
          <q-item-section avatar>
            <q-icon name="rate_review" />
          </q-item-section>
          <q-item-section>{{ t('nav.reviews') }}</q-item-section>
        </q-item>

        <q-expansion-item
          v-if="agentEnabled"
          v-model="chatsOpen"
          expand-separator
          :expand-icon-class="isDark ? 'text-grey-4' : 'text-grey-8'"
        >
          <template #header>
            <q-item-section avatar>
              <q-icon :name="AGENT_ICON" />
            </q-item-section>
            <q-item-section>{{ t('agent.chats.title') }}</q-item-section>
            <q-item-section v-if="agentStore.canAddChat" side>
              <q-btn
                flat
                round
                dense
                size="sm"
                icon="add"
                :class="isDark ? 'text-grey-4' : 'text-grey-8'"
                :aria-label="t('agent.chats.add')"
                @click.stop="agentStore.openNewChatDialog()"
              >
                <q-tooltip>{{ t('agent.chats.add') }}</q-tooltip>
              </q-btn>
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
        <q-item v-ripple clickable @click="toggleTheme">
          <q-item-section avatar>
            <q-icon :name="isDark ? 'light_mode' : 'dark_mode'" />
          </q-item-section>
          <q-item-section>
            {{ isDark ? t('theme.switchToLight') : t('theme.switchToDark') }}
          </q-item-section>
        </q-item>
      </q-list>
    </div>
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
