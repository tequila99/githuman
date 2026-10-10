<script setup lang="ts">
import type { ChatItem } from '@/utils/agent-chat'
import AgentUserMessage from './AgentUserMessage.vue'
import AgentAssistantMessage from './AgentAssistantMessage.vue'
import AgentToolCard from './AgentToolCard.vue'
import AgentThoughtMessage from './AgentThoughtMessage.vue'
import AgentAutoApprovedMessage from './AgentAutoApprovedMessage.vue'
import AgentErrorMessage from './AgentErrorMessage.vue'

defineProps<{
  item: ChatItem
  chatId: string
  /** Offer to continue only after the error that ended the turn. */
  canContinue?: boolean
}>()
const emit = defineEmits<{ (e: 'continue'): void }>()
</script>

<template>
  <AgentUserMessage
    v-if="item.kind === 'user'"
    :item="item"
    :chat-id="chatId"
  />
  <AgentAssistantMessage
    v-else-if="item.kind === 'agent'"
    :text="item.text"
    :source="{ type: 'message', sessionId: chatId, messageId: item.id }"
  />
  <AgentThoughtMessage v-else-if="item.kind === 'thought'" :text="item.text" />
  <AgentAutoApprovedMessage
    v-else-if="item.kind === 'auto-approved'"
    :title="item.title"
  />

  <AgentToolCard
    v-else-if="item.kind === 'tool'"
    class="agent-item"
    :item="item"
  />

  <AgentErrorMessage
    v-else
    :text="item.text"
    :can-continue="canContinue"
    @continue="emit('continue')"
  />
</template>
