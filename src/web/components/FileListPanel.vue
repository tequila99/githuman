<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useDiffStore } from '@/stores/diff-store'
import { useFileExplorerStore } from '@/stores/file-explorer-store'
import { pathOf } from '@/utils/diff-file'
import FileExplorerTabs from './FileExplorerTabs.vue'
import SearchInput from './SearchInput.vue'
import FileTreeNode from './FileTreeNode.vue'
import FileListItem from './FileListItem.vue'
import BrowseModeToggle from './BrowseModeToggle.vue'

const { t } = useI18n()

const {
  stagedFiles,
  unstagedFiles,
  loading: diffLoading
} = storeToRefs(useDiffStore())

const explorer = useFileExplorerStore()
const {
  source,
  browseMode,
  filter,
  selectedPath,
  expandedFolders,
  treeLoading,
  filteredDiffFiles,
  filteredTree,
  totalTreeFiles
} = storeToRefs(explorer)
</script>

<template>
  <div class="file-list-panel__header q-pa-sm">
    <FileExplorerTabs
      v-if="!browseMode"
      v-model="source"
      :staged-files-length="stagedFiles.length"
      :unstaged-files-length="unstagedFiles.length"
    />
    <div v-else class="text-subtitle2 q-mb-sm">
      {{ t('browse.allFiles') }}
      <span class="text-primary">({{ totalTreeFiles }})</span>
    </div>

    <SearchInput
      v-model="filter"
      :placeholder="
        browseMode
          ? t('browse.searchPlaceholder')
          : t('changes.filterPlaceholder')
      "
    />
  </div>

  <q-separator />

  <q-scroll-area
    class="col file-list-panel__scroll"
    content-style="padding: 4px 0"
    content-active-style="padding: 4px 0"
  >
    <div
      v-if="browseMode ? treeLoading : diffLoading"
      class="row justify-center q-pa-lg"
    >
      <q-spinner color="primary" size="2em" />
    </div>

    <template v-else-if="browseMode">
      <p
        v-if="filteredTree.length === 0"
        class="text-caption text-grey-6 q-px-md q-py-sm"
      >
        {{ filter ? t('browse.noMatchingFiles') : t('browse.noFiles') }}
      </p>
      <FileTreeNode
        v-for="node in filteredTree"
        :key="node.path"
        :node="node"
        :selected-path="selectedPath"
        :expanded-folders="expandedFolders"
        :level="0"
        @toggle-folder="explorer.toggleFolder"
        @file-select="explorer.selectFile"
      />
    </template>

    <template v-else>
      <p
        v-if="filteredDiffFiles.length === 0"
        class="text-caption text-grey-6 q-px-md q-py-sm"
      >
        {{ filter ? t('browse.noMatchingFiles') : t('changes.emptyFileList') }}
      </p>
      <FileListItem
        v-for="file in filteredDiffFiles"
        :key="pathOf(file)"
        :file="file"
        :selected="selectedPath === pathOf(file)"
        :source="source"
        @click="explorer.selectFile(pathOf(file))"
      />
    </template>
  </q-scroll-area>

  <q-separator />

  <BrowseModeToggle v-model="browseMode" />
</template>

<style scoped>
/* Force scroll-area content to the container width so long paths
   truncate with an ellipsis instead of growing the content wider
   and triggering horizontal scroll. */
.file-list-panel__scroll :deep(.q-scrollarea__content) {
  width: 100%;
}
</style>
