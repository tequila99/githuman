<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useWorkspaceNavigation } from '@/composables/use-workspace-navigation'
import { useWorkspaceSwipe } from '@/composables/use-workspace-swipe'
import { useAgentStore } from '@/stores/agent-store'
import { useFileExplorerStore } from '@/stores/file-explorer-store'
import type { WorkspacePane } from '@/utils/workspace-navigation'
import { aggregateAgentStatus } from '@/utils/agent-chat-status'

const { t } = useI18n()
const emit = defineEmits<{ resize: [height: number] }>()
const route = useRoute()
const workspace = useWorkspaceNavigation()
const gestures = useWorkspaceSwipe()
const agent = useAgentStore()
const explorer = useFileExplorerStore()
const status = computed(() =>
  aggregateAgentStatus(agent.list.map(entry => entry.chat))
)
const tabs = computed(() =>
  workspace.projection.value.panes.map(name => ({
    name,
    icon:
      name === 'agent'
        ? 'smart_toy'
        : name === 'list'
          ? 'format_list_bulleted'
          : 'description',
    label:
      name === 'agent'
        ? t('nav.agent')
        : route.path.startsWith('/reviews')
          ? t('nav.reviews')
          : name === 'list'
            ? t(
                route.path.startsWith('/notes')
                  ? 'notes.title'
                  : 'workspace.list'
              )
            : route.path.startsWith('/notes')
              ? t('workspace.note')
              : explorer.browseMode
                ? t('workspace.file')
                : t('nav.changes')
  }))
)
</script>
<template>
  <q-footer
    v-touch-swipe.horizontal="gestures.swipe"
    @touchstart="gestures.start"
    bordered
    :class="$q.dark.isActive ? 'bg-dark text-white' : 'bg-white text-dark'"
    class="workspace-footer"
  >
    <q-resize-observer @resize="size => emit('resize', size.height)" />
    <q-tabs
      :model-value="workspace.pane.value"
      no-caps
      align="justify"
      active-color="primary"
      indicator-color="primary"
      @update:model-value="
        value => workspace.selectPane(value as WorkspacePane)
      "
    >
      <q-tab
        v-for="tab in tabs"
        :key="tab.name"
        :name="tab.name"
        :icon="tab.icon"
        :label="tab.label"
        :aria-label="tab.label"
      >
        <q-badge
          v-if="tab.name === 'agent' && status"
          floating
          :color="status === 'attention' ? 'warning' : 'primary'"
          :label="status === 'attention' ? '!' : '…'"
          :aria-label="
            t(
              status === 'attention'
                ? 'agent.chats.needsAnswer'
                : 'workspace.working'
            )
          "
        />
      </q-tab>
    </q-tabs>
  </q-footer>
</template>
<style scoped>
.workspace-footer {
  padding-bottom: env(safe-area-inset-bottom);
}
.workspace-footer :deep(.q-tab) {
  min-height: 64px;
  min-width: 44px;
}
.workspace-footer :deep(.q-tab__icon) {
  font-size: 28px;
}
</style>
