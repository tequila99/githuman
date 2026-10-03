<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useAgentStore } from '@/stores/agent-store'
import { AGENT_ICON } from '@/utils/agent-icon'

const { t } = useI18n()
const store = useAgentStore()
</script>

<template>
  <div class="agent-empty column items-center justify-center text-center fit">
    <q-icon :name="AGENT_ICON" size="48px" class="text-grey-6" />
    <div class="text-subtitle1 q-mt-md">{{ t('agent.emptyState.title') }}</div>
    <div class="text-caption text-grey-6 q-mt-xs agent-empty__hint">
      {{ t('agent.emptyState.hint') }}
    </div>
    <q-btn
      v-if="store.canAddChat"
      color="primary"
      unelevated
      no-caps
      icon="add"
      class="q-mt-md"
      :label="t('agent.emptyState.add')"
      @click="store.openNewChatDialog()"
    />
  </div>
</template>

<style scoped>
.agent-empty {
  padding: 24px;
}
.agent-empty__hint {
  max-width: 260px;
}
</style>
