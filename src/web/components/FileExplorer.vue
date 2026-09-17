<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useFileExplorerStore } from '@/stores/file-explorer-store'
import { useActiveReviewStore } from '@/stores/active-review-store'
import { useServerEvents } from '@/composables/use-server-events'
import PanelResize from './PanelResize.vue'
import FileListPanel from './FileListPanel.vue'
import DiffPanel from './DiffPanel.vue'
import FileContentPanel from './FileContentPanel.vue'

const explorer = useFileExplorerStore()
const activeReviewStore = useActiveReviewStore()
const { browseMode } = storeToRefs(explorer)

onMounted(() => {
  void explorer.refresh()
  void activeReviewStore.refresh()
})

const events = useServerEvents(
  ['files:changed'],
  () => void explorer.refreshFromServerEvent()
)
onUnmounted(() => events.close())

const reviewEvents = useServerEvents(
  [
    'review:created',
    'review:updated',
    'review:deleted',
    'comment:created',
    'comment:updated',
    'comment:deleted'
  ],
  () => void activeReviewStore.refresh()
)
onUnmounted(() => reviewEvents.close())
</script>

<template>
  <PanelResize>
    <template #panel>
      <FileListPanel />
    </template>
    <template #content>
      <FileContentPanel v-if="browseMode" />
      <DiffPanel v-else />
    </template>
  </PanelResize>
</template>
