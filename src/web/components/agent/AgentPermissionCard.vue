<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { PendingPermission } from '@/utils/agent-chat'
import AgentDiffView from './AgentDiffView.vue'

// Quiet by default: a request is routine, so only the answer that lets the
// agent proceed is filled in, and rejections stay flat.
const STYLE = {
  allow_once: { color: 'primary', outline: false, flat: false },
  allow_always: { color: 'primary', outline: true, flat: false },
  reject_once: { color: 'negative', outline: false, flat: true },
  reject_always: { color: 'negative', outline: false, flat: true }
} as const

defineProps<{ permission: PendingPermission }>()
const emit = defineEmits<{
  (e: 'answer', optionId: string | undefined): void
}>()

const { t } = useI18n()
</script>

<template>
  <div class="agent-permission">
    <div class="row no-wrap items-center agent-permission__head">
      <q-icon name="gpp_maybe" color="warning" size="14px" class="q-mr-xs" />
      <span>{{ t('agent.permission.title') }}</span>
    </div>
    <div class="agent-permission__title" :title="permission.title">
      {{ permission.title }}
    </div>
    <q-expansion-item
      v-if="permission.diffs.length > 0"
      dense
      dense-toggle
      class="agent-permission__changes"
      :label="t('agent.permission.showChanges')"
    >
      <AgentDiffView v-for="d in permission.diffs" :key="d.path" :diff="d" />
    </q-expansion-item>
    <div class="row items-center q-gutter-xs q-mt-xs">
      <q-btn
        v-for="option in permission.options"
        :key="option.optionId"
        no-caps
        dense
        size="sm"
        class="q-px-sm"
        :unelevated="!STYLE[option.kind].outline && !STYLE[option.kind].flat"
        :outline="STYLE[option.kind].outline"
        :flat="STYLE[option.kind].flat"
        :color="STYLE[option.kind].color"
        :label="option.name"
        @click="emit('answer', option.optionId)"
      />
      <q-btn
        no-caps
        dense
        flat
        size="sm"
        class="q-px-sm"
        :label="t('agent.permission.cancel')"
        @click="emit('answer', undefined)"
      />
    </div>
  </div>
</template>

<style scoped>
.agent-permission {
  padding: 6px 10px 8px;
  border: 1px solid rgba(128, 128, 128, 0.3);
  border-left: 3px solid var(--q-warning);
  border-radius: 4px;
  font-size: 12px;
}
.agent-permission__head {
  font-size: 11px;
  opacity: 0.7;
}
.agent-permission__title {
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-permission__changes {
  font-size: 11px;
}
.agent-permission__changes :deep(.q-item) {
  min-height: 24px;
  padding: 0;
}
</style>
