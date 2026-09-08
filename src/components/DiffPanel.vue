<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useFileExplorerStore } from '@/stores/file-explorer-store'
import { pathOf } from '@/utils/diff-file'
import DiffStatusBar from './DiffStatusBar.vue'
import DiffFileCard from './DiffFileCard.vue'

const { t } = useI18n()

const explorer = useFileExplorerStore()
const { source, diffFiles, expandedFiles } = storeToRefs(explorer)
</script>

<template>
  <div v-if="diffFiles.length === 0" class="q-pa-md text-grey-6">
    {{ t('changes.emptyDiffPanel') }}
  </div>

  <template v-else>
    <DiffStatusBar
      :files="diffFiles"
      @expand-all="explorer.expandAllFiles"
      @collapse-all="explorer.collapseAllFiles"
    />
    <q-separator />
    <q-scroll-area
      class="col"
      content-style="padding: 8px"
      content-active-style="padding: 8px"
    >
      <DiffFileCard
        v-for="file in diffFiles"
        :key="pathOf(file)"
        :file="file"
        :source="source"
        :expanded="expandedFiles.has(pathOf(file))"
        @toggle="explorer.handleCardToggle(pathOf(file))"
        @expand="explorer.expandFile(pathOf(file))"
      />
    </q-scroll-area>
  </template>
</template>
