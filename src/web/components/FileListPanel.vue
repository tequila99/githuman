<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { QScrollArea } from 'quasar'
import { useI18n } from 'vue-i18n'
import { useDiffStore } from '@/stores/diff-store'
import { useFileExplorerStore } from '@/stores/file-explorer-store'
import { pathOf } from '@/utils/diff-file'
import FileExplorerTabs from './FileExplorerTabs.vue'
import SearchInput from './SearchInput.vue'
import FileTreeNode from './FileTreeNode.vue'
import FileListItem from './FileListItem.vue'
import BrowseModeToggle from './BrowseModeToggle.vue'
import DiffTreeFolderRow from './DiffTreeFolderRow.vue'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'

// Row height guess for the file list, in px. Quasar replaces it with measured heights.
const ROW_HEIGHT_ESTIMATE = 32

const { t } = useI18n()

const {
  stagedFiles,
  unstagedFiles,
  initialLoading: diffLoading,
  error: loadError
} = storeToRefs(useDiffStore())

const explorer = useFileExplorerStore()
const {
  source,
  browseMode,
  filter,
  selectedPath,
  expandedFolders,
  treeInitialLoading,
  treeError,
  filteredDiffFiles,
  diffTreeRows,
  diffFileByPath,
  diffListMode,
  filtering,
  filteredTree,
  totalTreeFiles
} = storeToRefs(explorer)

// `q-virtual-scroll` scrolls this element. A template ref is set after the children
// mount, so the list renders once it is known.
const scrollArea = ref<QScrollArea | null>(null)
const scrollTarget = computed(() => scrollArea.value?.getScrollTarget() ?? null)
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
      <span v-if="totalTreeFiles > 0 || !treeError" class="text-primary"
        >({{ totalTreeFiles }})</span
      >
    </div>

    <div class="row no-wrap items-center q-gutter-x-xs">
      <SearchInput
        v-model="filter"
        class="col"
        :placeholder="
          browseMode
            ? t('browse.searchPlaceholder')
            : t('changes.filterPlaceholder')
        "
      />
      <q-btn
        v-if="!browseMode"
        flat
        dense
        round
        size="sm"
        icon="account_tree"
        :color="diffListMode === 'tree' ? 'primary' : undefined"
        :aria-label="t('changes.listMode.tree')"
        :aria-pressed="diffListMode === 'tree'"
        @click="diffListMode = diffListMode === 'tree' ? 'list' : 'tree'"
      >
        <q-tooltip :delay="TOOLTIP_DELAY_MS">
          {{ t('changes.listMode.tree') }}
        </q-tooltip>
      </q-btn>
    </div>
  </div>

  <q-separator />

  <q-scroll-area
    ref="scrollArea"
    class="col file-list-panel__scroll"
    content-style="padding: 4px 0"
    content-active-style="padding: 4px 0"
  >
    <div
      v-if="browseMode ? treeInitialLoading : diffLoading"
      class="row justify-center q-pa-lg"
    >
      <q-spinner color="primary" size="2em" />
    </div>

    <template v-else-if="browseMode">
      <p
        v-if="
          filteredTree.length === 0 &&
          (!treeError || (filter && totalTreeFiles > 0))
        "
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
        v-if="filteredDiffFiles.length === 0 && (filter || !loadError)"
        class="text-caption text-grey-6 q-px-md q-py-sm"
      >
        {{ filter ? t('browse.noMatchingFiles') : t('changes.emptyFileList') }}
      </p>
      <!-- The key holds the source and the mode: with the same length Quasar would keep the old heights. -->
      <q-virtual-scroll
        v-if="scrollTarget && diffListMode === 'tree'"
        :key="`${source}:tree`"
        :scroll-target="scrollTarget"
        :items="diffTreeRows"
        :virtual-scroll-item-size="ROW_HEIGHT_ESTIMATE"
      >
        <template #default="{ item: row }">
          <DiffTreeFolderRow
            v-if="row.kind === 'folder'"
            :key="`d:${row.path}`"
            :name="row.name"
            :path="row.path"
            :depth="row.depth"
            :expanded="row.expanded"
            :locked="filtering"
            @toggle="explorer.toggleDiffFolder(row.paths)"
          />
          <FileListItem
            v-else-if="diffFileByPath.get(row.path)"
            :key="`f:${row.path}`"
            :file="diffFileByPath.get(row.path)!"
            :label="row.name"
            :depth="row.depth"
            :selected="selectedPath === row.path"
            :source="source"
            @click="explorer.selectFile(row.path)"
          />
        </template>
      </q-virtual-scroll>
      <q-virtual-scroll
        v-else-if="scrollTarget"
        :key="`${source}:list`"
        :scroll-target="scrollTarget"
        :items="filteredDiffFiles"
        :virtual-scroll-item-size="ROW_HEIGHT_ESTIMATE"
      >
        <template #default="{ item: file }">
          <FileListItem
            :key="pathOf(file)"
            :file="file"
            :selected="selectedPath === pathOf(file)"
            :source="source"
            @click="explorer.selectFile(pathOf(file))"
          />
        </template>
      </q-virtual-scroll>
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
