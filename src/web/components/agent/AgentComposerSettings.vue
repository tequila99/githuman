<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentConfigOption } from '@/api/types'
import type { AgentChatEntry } from '@/utils/agent-chat'
import AgentChatStatusDot from './AgentChatStatusDot.vue'
import AgentConfigButton from './AgentConfigButton.vue'
import AgentAutoApproveButton from './AgentAutoApproveButton.vue'
import AgentSpeechLanguageButton from './AgentSpeechLanguageButton.vue'
import { speechRecognizerClass } from '@/utils/speech'
const props = defineProps<{
  entry: AgentChatEntry
  modelOption: AgentConfigOption | undefined
  modeOption: AgentConfigOption | undefined
  otherOptions: AgentConfigOption[]
  settingsLocked: boolean
}>()
const emit = defineEmits<{
  select: [option: AgentConfigOption, value: string | boolean]
  'toggle-auto-approve': []
}>()
const { t } = useI18n()
const status = computed(() => props.entry.chat.status)
const autoApprove = computed(() => props.entry.chat.autoApprove)
// The language choice matters only where the browser can recognize speech.
const speechSupported =
  typeof window !== 'undefined' && speechRecognizerClass(window) !== null
</script>
<template>
  <div class="agent-composer__status row no-wrap items-center">
    <span class="row no-wrap items-center agent-composer__state">
      <AgentChatStatusDot :entry="entry" />
      <span class="q-ml-xs">{{ t(`agent.status.${status}`) }}</span>
    </span>
    <div class="agent-composer__options col row items-center q-gutter-x-xs">
      <AgentConfigButton
        v-if="modelOption"
        :option="modelOption"
        :disabled="settingsLocked"
        @select="value => emit('select', modelOption!, value)"
      />
      <AgentConfigButton
        v-if="modeOption"
        :option="modeOption"
        :disabled="settingsLocked"
        :hint="t('agent.modeHint')"
        @select="value => emit('select', modeOption!, value)"
      />
      <AgentConfigButton
        v-for="option in otherOptions"
        :key="option.id"
        :option="option"
        :disabled="settingsLocked"
        @select="value => emit('select', option, value)"
      />
    </div>
    <div class="agent-composer__actions row no-wrap items-center">
      <AgentSpeechLanguageButton v-if="speechSupported" />
      <AgentAutoApproveButton
        :enabled="autoApprove"
        :disabled="status === 'closed'"
        @toggle="emit('toggle-auto-approve')"
      />
    </div>
  </div>
</template>
<style scoped>
.agent-composer__status {
  margin-top: 4px;
  min-height: 28px;
}
.agent-composer__state {
  padding-right: 8px;
  font-size: 12px;
  opacity: 0.8;
}
.workspace--narrow .agent-composer__status {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
}
.workspace--narrow .agent-composer__options {
  grid-column: 1 / -1;
  grid-row: 1;
  width: 100%;
  margin-left: 0;
  column-gap: 4px;
}
.workspace--narrow .agent-composer__options > :deep(.q-btn) {
  margin-left: 0;
  max-width: 100%;
}
.workspace--narrow .agent-composer__state {
  grid-column: 1;
  grid-row: 2;
}
.workspace--narrow .agent-composer__actions {
  grid-column: 2;
  grid-row: 2;
}
</style>
