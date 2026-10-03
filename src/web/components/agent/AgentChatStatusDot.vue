<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentChatEntry } from '@/utils/agent-chat'

const props = defineProps<{ entry: AgentChatEntry }>()
const { t } = useI18n()

/** What the chat wants from the user, most pressing first. */
const state = computed(() => {
  const { chat } = props.entry
  if (chat.permissions.length > 0) return 'attention'
  if (chat.status === 'closed') return 'closed'
  if (chat.status === 'busy' || chat.status === 'starting') return 'working'
  return 'idle'
})

const label = computed(() =>
  state.value === 'attention'
    ? t('agent.chats.needsAnswer')
    : t(`agent.status.${props.entry.chat.status}`)
)
</script>

<template>
  <span class="agent-dot" :aria-label="label" role="img">
    <q-spinner-dots v-if="state === 'working'" color="primary" size="14px" />
    <span v-else class="agent-dot__mark" :class="`agent-dot__mark--${state}`" />
  </span>
</template>

<style scoped>
.agent-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}
.agent-dot__mark {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--q-positive);
  opacity: 0.55;
}
.agent-dot__mark--attention {
  background: var(--q-warning);
  opacity: 1;
}
.agent-dot__mark--closed {
  background: var(--q-negative);
  opacity: 1;
}
</style>
