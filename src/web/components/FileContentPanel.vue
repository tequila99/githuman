<script setup lang="ts">
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useFileExplorerStore } from '@/stores/file-explorer-store'
import FileCardFrame from './FileCardFrame.vue'
import FileCardHeader from './FileCardHeader.vue'
import FileHeaderMenu from './FileHeaderMenu.vue'
import FileContentView from './FileContentView.vue'
import { isMarkdown } from '@/utils/file-wrap'

const { t } = useI18n()

const explorer = useFileExplorerStore()
const { selectedPath, browseFileLines, browseFileIsBinary, browseFileLoading } =
  storeToRefs(explorer)

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
  <div v-if="!selectedPath" class="q-pa-md text-grey-6">
    {{ t('browse.selectFile') }}
  </div>

  <FileCardFrame v-else class="col">
    <template #header>
      <FileCardHeader :path="selectedPath">
        <FileHeaderMenu v-model="wrap" />
      </FileCardHeader>
    </template>

    <div v-if="browseFileLoading" class="row justify-center q-pa-lg">
      <q-spinner color="primary" size="2em" />
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
