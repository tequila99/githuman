<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useFileExplorerStore } from '@/stores/file-explorer-store'
import { useServerEvents } from '@/composables/use-server-events'
import PanelResize from './PanelResize.vue'
import FileListPanel from './FileListPanel.vue'
import DiffPanel from './DiffPanel.vue'
import FileContentPanel from './FileContentPanel.vue'

const explorer = useFileExplorerStore()
const { browseMode } = storeToRefs(explorer)

onMounted(() => void explorer.refresh())

const events = useServerEvents(
  ['files:changed'],
  () => void explorer.refreshFromServerEvent()
)
onUnmounted(() => events.close())
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
