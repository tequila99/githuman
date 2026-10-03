<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{ title: string }>()
const { t } = useI18n()
</script>

<template>
  <div
    class="agent-item agent-auto-approved row no-wrap items-center text-grey-6"
  >
    <q-icon name="gpp_maybe" color="warning" class="q-mr-xs" />
    <span class="ellipsis">{{
      t('agent.autoApprove.approved', { title })
    }}</span>
  </div>
</template>

<style scoped>
.agent-auto-approved {
  font-size: 11px;
}
.agent-auto-approved :deep(.q-icon) {
  font-size: 14px;
}
</style>
