<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAgentStore } from '@/stores/agent-store'
import type { JournalEntry } from '@/api/types'

const props = defineProps<{ entry: JournalEntry; compact?: boolean }>()
const { t } = useI18n()
const agent = useAgentStore()
const provenance = computed(() => props.entry.provenance ?? props.entry.context)
const available = computed(() => agent.chats)
</script>
<template>
  <span
    class="journal-provenance"
    :class="{ 'journal-provenance--compact': compact }"
  >
    <template v-if="provenance || entry.sessionId">
      <a
        v-if="entry.sessionId && available[entry.sessionId]"
        class="journal-provenance__tag journal-provenance__tag--agent"
        href="#"
        v-close-popup
        @click.stop.prevent="agent.openChat(entry.sessionId)"
        >{{ provenance?.agentName ?? t('journal.context.unknown') }}</a
      >
      <span
        v-else
        class="journal-provenance__tag journal-provenance__tag--agent"
        >{{ provenance?.agentName ?? t('journal.context.unknown') }}</span
      >
      <span
        class="journal-provenance__tag journal-provenance__tag--model"
        :title="t('journal.context.model')"
      >
        {{ provenance?.model ?? t('journal.context.unknown') }}</span
      >
      <span
        class="journal-provenance__tag journal-provenance__tag--reasoning"
        :title="t('journal.context.reasoning')"
      >
        {{ provenance?.reasoning ?? t('journal.context.unknown') }}</span
      >
    </template>
    <span v-if="entry.sessionId" class="journal-provenance__id"
      >{{ t('journal.context.session') }}: {{ entry.sessionId }}</span
    >
    <span v-else-if="!compact">{{ t('journal.context.noSession') }}</span>
    <template v-if="!compact">
      <span v-if="entry.turnId" class="journal-provenance__id"
        >{{ t('journal.context.turn') }}: {{ entry.turnId }}</span
      >
      <span v-if="provenance"
        >{{ provenance.sessionName }} · {{ provenance.presetId }}</span
      >
      <span v-for="setting in provenance?.settings" :key="setting.id"
        >{{ setting.name }}: {{ setting.value }}</span
      >
      <span v-if="entry.sessionId && !available[entry.sessionId]">{{
        t('journal.context.chatUnavailable')
      }}</span>
    </template>
  </span>
</template>
<style scoped>
.journal-provenance {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  font-size: inherit;
  line-height: inherit;
  gap: 4px 8px;
  overflow-wrap: anywhere;
}
.journal-provenance__tag {
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--q-primary);
  background: color-mix(in srgb, var(--q-primary) 12%, transparent);
  text-decoration: none;
}
.journal-provenance__tag--model {
  color: #8e44ad;
  background: rgba(155, 89, 182, 0.14);
}
.journal-provenance__tag--reasoning {
  color: #218477;
  background: rgba(38, 166, 154, 0.14);
}
.body--dark .journal-provenance__tag--model {
  color: #d7a6ed;
}
.body--dark .journal-provenance__tag--reasoning {
  color: #80cbc4;
}
.workspace--narrow .journal-provenance--compact .journal-provenance__id {
  display: none;
}
.journal-provenance__id {
  font-family: monospace;
}
</style>
