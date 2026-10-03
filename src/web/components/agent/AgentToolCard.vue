<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ChatItem } from '@/utils/agent-chat'
import AgentDiffView from './AgentDiffView.vue'

// Identify tool kinds without repeating icons in the template.
const KIND_ICON: Record<string, string> = {
  read: 'description',
  edit: 'edit',
  delete: 'delete',
  move: 'drive_file_move',
  search: 'search',
  execute: 'terminal',
  think: 'psychology',
  fetch: 'cloud_download',
  switch_mode: 'swap_horiz'
}

// Distinguish pending, running, successful, and failed tools.
const STATUS_COLOR = {
  pending: 'grey',
  in_progress: 'primary',
  completed: 'positive',
  failed: 'negative'
} as const

defineProps<{ item: Extract<ChatItem, { kind: 'tool' }> }>()

const { t } = useI18n()
</script>

<template>
  <q-expansion-item
    dense
    dense-toggle
    switch-toggle-side
    class="agent-tool"
    :default-opened="item.diffs.length > 0"
  >
    <template #header>
      <q-item-section avatar class="agent-tool__icon">
        <q-icon :name="KIND_ICON[item.toolKind ?? ''] ?? 'build'" size="14px" />
      </q-item-section>
      <q-item-section>
        <q-item-label class="ellipsis">
          {{ item.title || item.locations[0] || item.toolKind }}
        </q-item-label>
      </q-item-section>
      <q-item-section side>
        <q-spinner
          v-if="item.status === 'in_progress'"
          size="12px"
          color="primary"
        />
        <q-badge
          v-else
          outline
          class="agent-tool__badge"
          rounded
          :color="STATUS_COLOR[item.status]"
          :label="
            item.status === 'failed'
              ? t('agent.tool.failed')
              : item.status === 'completed'
                ? '✓'
                : '…'
          "
        />
      </q-item-section>
    </template>

    <div class="q-px-sm q-pb-xs column q-gutter-y-xs agent-tool__body">
      <div
        v-for="path in item.locations.filter(
          l => !item.diffs.some(d => d.path === l)
        )"
        :key="path"
        class="text-mono text-caption text-grey-6 ellipsis"
      >
        {{ path }}
      </div>
      <AgentDiffView v-for="d in item.diffs" :key="d.path" :diff="d" />
      <template v-if="item.output">
        <div class="agent-tool__caption text-grey-6">{{
          t('agent.tool.output')
        }}</div>
        <pre class="agent-tool__output text-mono">{{ item.output }}</pre>
      </template>
    </div>
  </q-expansion-item>
</template>

<style scoped>
/* Tool calls are service lines: well below the size of the chat text. */
.agent-tool {
  border: 1px solid var(--q-separator-color, rgba(128, 128, 128, 0.3));
  border-radius: 6px;
  font-size: 11px;
}
.agent-tool :deep(.q-item) {
  min-height: 26px;
  padding: 0 8px;
}
.agent-tool :deep(.q-item__label) {
  font-size: 11px;
}
.agent-tool :deep(.q-item__section--side) {
  padding-left: 6px;
}
.agent-tool__icon {
  min-width: 22px;
  padding-right: 6px;
}
.agent-tool__badge {
  font-size: 10px;
}
.agent-tool__caption,
.agent-tool__body {
  font-size: 11px;
}
.agent-tool__output {
  margin: 0;
  max-height: 200px;
  overflow: auto;
  font-size: 11px;
  white-space: pre-wrap;
}
</style>
