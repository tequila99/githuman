<script setup lang="ts">
import AddButton from '@/components/buttons/AddButton.vue'
import { useI18n } from 'vue-i18n'
import { useAgentStore } from '@/stores/agent-store'
import { AGENT_ICON } from '@/utils/agent-icon'

const { t } = useI18n()
const store = useAgentStore()
</script>

<template>
  <div class="agent-empty column items-center justify-center text-center fit">
    <q-icon :name="AGENT_ICON" size="48px" class="app-icon-neutral" />
    <div class="text-subtitle1 q-mt-md">{{ t('agent.emptyState.title') }}</div>
    <div class="text-caption text-grey-6 q-mt-xs agent-empty__hint">
      {{ t('agent.emptyState.hint') }}
    </div>
    <AddButton
      v-if="store.canAddChat"
      color="primary"
      unelevated
      class="q-mt-md"
      :label="t('agent.emptyState.add')"
      @click="store.openNewChatDialog()"
      :dense="false"
      :flat="false"
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
