<script setup lang="ts">
import { useAgentStore } from '@/stores/agent-store'
import AgentChatView from './AgentChatView.vue'
import AgentEmptyState from './AgentEmptyState.vue'
import AgentTabs from './AgentTabs.vue'

const store = useAgentStore()
</script>

<template>
  <div class="agent-panel column no-wrap fit">
    <q-banner
      v-if="store.error && !store.newChatDialog.open"
      dense
      class="bg-negative text-white"
    >
      {{ store.error }}
    </q-banner>

    <AgentEmptyState v-if="store.list.length === 0" class="col" />
    <template v-else>
      <AgentTabs />
      <!-- Every chat stays mounted, only the active one is shown: drafts and
           scroll positions survive switching tabs, and a closed chat is gone. -->
      <div class="col agent-panel__views">
        <AgentChatView
          v-for="entry in store.list"
          v-show="entry.info.id === store.activeId"
          :key="entry.info.id"
          :chat-id="entry.info.id"
          :active="entry.info.id === store.activeId"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.agent-panel__views {
  position: relative;
  min-height: 0;
}
</style>
