<script setup lang="ts">
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import type { TerminalInfo } from '../../../shared/terminal/types.ts'
import { MAX_TERMINAL_SESSIONS } from '../../../shared/terminal/constants.ts'
import { terminalDirectoryTitle } from '@/utils/terminal-window'
import { useI18n } from 'vue-i18n'
defineProps<{
  sessions: TerminalInfo[]
  activeId: string | null
  busy: boolean
  connected: boolean
}>()
const emit = defineEmits<{
  activate: [id: string]
  create: []
  requestClose: [id: string]
}>()
const { t } = useI18n()
</script>
<template>
  <div class="terminal-tabs row items-center no-wrap">
    <q-tabs
      :model-value="activeId ?? undefined"
      dense
      shrink
      no-caps
      outside-arrows
      mobile-arrows
      align="left"
      active-color="primary"
      indicator-color="primary"
      class="terminal-tabs__tabs"
      @update:model-value="id => emit('activate', String(id))"
    >
      <q-tab
        v-for="session in sessions"
        :key="session.id"
        :name="session.id"
        :ripple="false"
        class="terminal-tab"
      >
        <div class="row items-center no-wrap terminal-tab__body">
          <span class="terminal-tab__name ellipsis">{{
            terminalDirectoryTitle(session.title)
          }}</span>
          <q-btn
            flat
            round
            dense
            size="xs"
            icon="close"
            class="q-ml-xs"
            :disable="!connected"
            :aria-label="t('terminal.closeTab')"
            @click.stop.prevent="emit('requestClose', session.id)"
          />
          <q-tooltip :delay="TOOLTIP_DELAY_MS">{{ session.title }}</q-tooltip>
        </div>
      </q-tab>
    </q-tabs>
    <q-btn
      flat
      round
      dense
      size="sm"
      icon="add"
      class="q-mx-xs"
      :loading="busy"
      :disable="!connected || sessions.length >= MAX_TERMINAL_SESSIONS"
      :aria-label="t('terminal.add')"
      @click="emit('create')"
    >
      <q-tooltip :delay="TOOLTIP_DELAY_MS">{{ t('terminal.add') }}</q-tooltip>
    </q-btn>
  </div>
</template>
<style scoped>
.terminal-tabs {
  flex: 0 0 auto;
  min-height: 36px;
  border-bottom: 1px solid var(--window-divider);
}
.terminal-tabs__tabs {
  min-width: 0;
}
.terminal-tab {
  padding: 0 8px;
  text-transform: none;
}
.terminal-tab__body {
  max-width: 200px;
  min-width: 0;
}
.terminal-tab__name {
  min-width: 0;
  font-size: 12px;
}
</style>
