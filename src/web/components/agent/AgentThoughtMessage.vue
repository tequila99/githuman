<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{ text: string }>()
const { t } = useI18n()
</script>

<template>
  <q-expansion-item
    dense
    dense-toggle
    class="agent-item agent-thought text-grey-6"
    :label="t('agent.thinking')"
    icon="psychology"
  >
    <div class="q-px-md q-pb-xs agent-thought__text">{{ text }}</div>
  </q-expansion-item>
</template>

<style scoped>
.agent-thought {
  font-size: 11px;
}
.agent-thought__text {
  font-size: 11px;
  white-space: pre-wrap;
}
.agent-thought :deep(.q-item) {
  min-height: 26px;
  padding: 0 8px;
}
.agent-thought :deep(.q-item__label),
.agent-thought :deep(.q-item__section--main) {
  font-size: 11px;
}
.agent-thought :deep(.q-icon) {
  font-size: 14px;
}
</style>
