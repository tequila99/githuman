<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFileContent } from '@/composables/use-file-content'
import PreviewDialog from './PreviewDialog.vue'
import MarkdownContent from './MarkdownContent.vue'

const props = defineProps<{ path: string }>()
const open = defineModel<boolean>({ required: true })
const { t } = useI18n()
const { lines, isBinary, loading, error, fetchContent } = useFileContent()
const text = computed(() => lines.value.join('\n'))

// Read the current file from disk, like the full-file view.
function load() {
  void fetchContent(props.path, 'WORKTREE')
}
</script>

<template>
  <PreviewDialog v-model="open" size="wide" :title="path" @before-show="load">
    <div
      v-if="loading && lines.length === 0"
      class="row justify-center q-pa-lg"
    >
      <q-spinner color="primary" size="28px" />
    </div>
    <div v-else-if="error" class="text-negative q-pa-md">{{ error }}</div>
    <div v-else-if="isBinary" class="text-grey-6 q-pa-md">
      {{ t('changes.previewBinary') }}
    </div>
    <MarkdownContent v-else class="md-preview__body" :text="text" />
  </PreviewDialog>
</template>

<style scoped>
.md-preview__body {
  padding: 16px 24px 24px;
}
.md-preview__body :deep(.md-content) {
  font-size: 14px;
}
</style>
