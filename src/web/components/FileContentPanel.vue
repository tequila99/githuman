<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useFileExplorerStore } from '@/stores/file-explorer-store'
import { useDiffStore } from '@/stores/diff-store'
import FileCardFrame from './FileCardFrame.vue'
import FileCardHeader from './FileCardHeader.vue'
import FileHeaderMenu from './FileHeaderMenu.vue'
import FileContentView from './FileContentView.vue'
import LoadErrorBanner from './LoadErrorBanner.vue'
import { isMarkdown } from '@/utils/file-wrap'

const { t } = useI18n()

const explorer = useFileExplorerStore()
const {
  selectedPath,
  browseFileLines,
  browseFileIsBinary,
  browseFileLoading,
  browseFileError,
  treeError,
  refreshing
} = storeToRefs(explorer)
const { error: diffError } = storeToRefs(useDiffStore())

// One banner: a server that is down fails both at once, and one Retry
// (refresh()) re-requests both anyway.
const loadError = computed(() => {
  if (diffError.value) {
    return { title: t('changes.loadError'), message: diffError.value }
  }
  if (treeError.value) {
    return { title: t('browse.treeLoadError'), message: treeError.value }
  }
  return null
})

const wrap = ref(false)

watch(
  selectedPath,
  path => {
    wrap.value = path ? isMarkdown(path) : false
  },
  { immediate: true }
)
</script>

<template>
  <!-- Here rather than in the sidebar: that one can be collapsed. -->
  <LoadErrorBanner
    v-if="loadError"
    :title="loadError.title"
    :message="loadError.message"
    :loading="refreshing"
    @retry="explorer.refresh()"
  />

  <div v-if="!selectedPath" class="q-pa-md text-grey-6">
    {{ t('browse.selectFile') }}
  </div>

  <FileCardFrame v-else class="col">
    <template #header>
      <FileCardHeader :path="selectedPath">
        <FileHeaderMenu v-model="wrap" />
      </FileCardHeader>
    </template>

    <!-- Spinner on first load only: a refetch keeps the lines on screen. -->
    <div
      v-if="
        browseFileLoading && browseFileLines.length === 0 && !browseFileError
      "
      class="row justify-center q-pa-lg"
    >
      <q-spinner color="primary" size="2em" />
    </div>

    <div v-else-if="browseFileError" class="q-pa-md text-grey-6">
      {{ t('changes.fullFileLoadError') }}
      <div class="text-caption">{{ browseFileError }}</div>
      <!-- Re-selecting the same file doesn't refetch it; refresh() does. -->
      <q-btn
        flat
        dense
        color="primary"
        class="q-mt-sm"
        :label="t('changes.retry')"
        :loading="refreshing"
        @click="explorer.refresh()"
      />
    </div>

    <div v-else-if="browseFileIsBinary" class="q-pa-md text-grey-6">
      {{ t('changes.binaryFile') }}
    </div>

    <q-scroll-area
      v-else
      class="col"
      content-style="padding: 8px"
      content-active-style="padding: 8px"
    >
      <FileContentView
        :path="selectedPath"
        :lines="browseFileLines"
        :wrap="wrap"
      />
    </q-scroll-area>
  </FileCardFrame>
</template>
