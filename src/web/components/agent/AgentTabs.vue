<script setup lang="ts">
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import { useAgentStore } from '@/stores/agent-store'
import type { AgentChatEntry } from '@/utils/agent-chat'
import AgentChatStatusDot from './AgentChatStatusDot.vue'
import { useNotifyError } from '@/composables/use-notify-error'

const { t } = useI18n()
const notifyError = useNotifyError()
const $q = useQuasar()
const store = useAgentStore()

function confirmClose(entry: AgentChatEntry) {
  const name = entry.info.name
  $q.dialog({
    title: t('agent.chats.closeTitle'),
    message:
      entry.chat.status === 'busy'
        ? t('agent.chats.closeBusy', { name })
        : t('agent.chats.closeMessage', { name }),
    ok: {
      label: t('agent.chats.close'),
      color: 'negative',
      flat: true,
      noCaps: true
    },
    cancel: { label: t('agent.chats.keep'), flat: true, noCaps: true }
  }).onOk(() => {
    store.closeChat(entry.info.id).catch((err: unknown) => {
      notifyError(t('agent.chats.closeFailed'), err)
    })
  })
}
</script>

<template>
  <div class="agent-tabs row no-wrap items-center">
    <q-tabs
      :model-value="store.activeId ?? undefined"
      dense
      shrink
      no-caps
      outside-arrows
      mobile-arrows
      align="left"
      active-color="primary"
      indicator-color="primary"
      class="agent-tabs__tabs"
      @update:model-value="id => store.selectChat(String(id))"
    >
      <q-tab
        v-for="entry in store.list"
        :key="entry.info.id"
        :name="entry.info.id"
        :ripple="false"
        class="agent-tab"
      >
        <div class="row items-center no-wrap agent-tab__body">
          <AgentChatStatusDot :entry="entry" class="q-mr-xs" />
          <span class="agent-tab__name ellipsis">{{ entry.info.name }}</span>
          <q-btn
            flat
            round
            dense
            size="xs"
            icon="close"
            class="q-ml-xs"
            :aria-label="t('agent.chats.close')"
            @click.stop.prevent="confirmClose(entry)"
          />
          <q-tooltip :delay="TOOLTIP_DELAY_MS">{{ entry.info.name }}</q-tooltip>
        </div>
      </q-tab>
    </q-tabs>
    <q-btn
      v-if="store.canAddChat"
      flat
      round
      dense
      size="sm"
      icon="add"
      class="q-mx-xs"
      :aria-label="t('agent.chats.add')"
      @click="store.openNewChatDialog()"
    >
      <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
        t('agent.chats.add')
      }}</q-tooltip>
    </q-btn>
  </div>
</template>

<style scoped>
.agent-tabs {
  flex: 0 0 auto;
  border-bottom: 1px solid var(--q-separator-color, rgba(128, 128, 128, 0.3));
}
.agent-tabs__tabs {
  min-width: 0;
}
.agent-tab {
  padding: 0 8px;
  text-transform: none;
}
.agent-tab__body {
  max-width: 180px;
  min-width: 0;
}
.agent-tab__name {
  min-width: 0;
  font-size: 13px;
}
</style>
