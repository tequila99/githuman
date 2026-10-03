<script setup lang="ts">
import type { ChatItem } from '@/utils/agent-chat'
import AgentMessageAttachments from './AgentMessageAttachments.vue'

defineProps<{ item: Extract<ChatItem, { kind: 'user' }> }>()
</script>

<template>
  <q-chat-message sent bg-color="primary" text-color="white" class="agent-item">
    <!-- QChatMessage makes a separate bubble for each root node in its slot. -->
    <div>
      <div class="agent-item__text">{{ item.text }}</div>
      <AgentMessageAttachments :context="item.context" />
    </div>
  </q-chat-message>
</template>

<style scoped lang="scss">
@use '@/css/agent-message';

.agent-item__text {
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
