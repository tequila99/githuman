<script setup lang="ts">
import {
  PREVIEW_MIN_SCALE,
  PREVIEW_MAX_SCALE
} from '@/constants/windows/constants'
import { defineAsyncComponent, computed, watch, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePreviewStore } from '@/stores/windows/preview-store'
import { usePreviewSource } from '@/composables/preview/use-preview-source'
import { usePreviewScroll } from '@/composables/preview/use-preview-scroll'
import type { PreviewTab } from '@/types/windows/preview'
import MarkdownContent from '@/components/MarkdownContent.vue'
import DiagramPreview from './DiagramPreview.vue'
import ImagePreview from './ImagePreview.vue'

const PdfPreview = defineAsyncComponent(() => import('./PdfPreview.vue'))
const props = defineProps<{ tab: PreviewTab; visible: boolean }>()
const preview = usePreviewStore()
const { t } = useI18n()
const el = useTemplateRef<HTMLElement>('scroll')
const overlay = useTemplateRef<HTMLElement>('overlay')
const { entry, reload } = usePreviewSource(
  () => props.tab,
  () => props.visible
)
const { rememberScroll, prepareRestore, restoreScroll } = usePreviewScroll({
  target: el,
  tab: () => props.tab,
  remember: preview.remember
})
const missingText = computed(() =>
  entry.value.missing ? t(`windows.missing.${entry.value.missing}`) : null
)
function zoom(delta: number) {
  props.tab.scale = Math.max(
    PREVIEW_MIN_SCALE,
    Math.min(PREVIEW_MAX_SCALE, props.tab.scale + delta)
  )
  preview.remember()
}
watch(
  () => [
    entry.value.text,
    entry.value.image,
    entry.value.pdf,
    entry.value.loaded,
    entry.value.error,
    entry.value.missing
  ],
  () => {
    prepareRestore()
    if (props.tab.kind === 'markdown' && entry.value.loaded) restoreScroll()
  },
  { immediate: true }
)
</script>

<template>
  <div class="preview-viewport">
    <div ref="scroll" class="preview-content" @scroll="rememberScroll">
      <div v-if="entry.loading && !entry.loaded" class="q-pa-lg"
        ><q-spinner color="primary"
      /></div>
      <div v-else-if="missingText" class="q-pa-lg text-grey-6">{{
        missingText
      }}</div>
      <div v-else-if="entry.error" class="q-pa-md text-negative"
        >{{ entry.error
        }}<q-btn flat :label="t('windows.retry')" @click="reload()"
      /></div>
      <MarkdownContent
        v-else-if="tab.kind === 'markdown'"
        class="preview-markdown"
        :text="entry.text"
        :preview-source="tab.source"
        :preview-title="tab.title"
      />
      <DiagramPreview
        v-else-if="tab.kind === 'diagram'"
        :text="entry.text"
        :scale="tab.scale"
        :visible="visible"
        :overlay="overlay"
        @zoom="zoom"
        @rendered="restoreScroll"
      />
      <template v-else-if="tab.kind === 'pdf'">
        <PdfPreview
          v-if="visible && entry.pdf"
          v-model:page="tab.index"
          :file="entry.pdf"
          :scale="tab.scale"
          :overlay="overlay"
          @zoom="zoom"
          @remember="preview.remember"
          @rendered="restoreScroll"
        />
      </template>
      <ImagePreview
        v-else-if="entry.image"
        :src="entry.image"
        :title="tab.title"
        :scale="tab.scale"
        :visible="visible"
        :overlay="overlay"
        @zoom="zoom"
        @rendered="restoreScroll"
      />
      <q-spinner
        v-if="entry.loading && entry.loaded"
        class="preview-refresh"
        color="primary"
      />
    </div>
    <div ref="overlay" class="preview-overlay" />
  </div>
</template>

<style scoped>
.preview-viewport {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.preview-overlay {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 2;
}
.preview-content {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.preview-markdown {
  padding: 24px clamp(32px, 8%, 128px);
}
.preview-markdown :deep(.md-content) {
  line-height: 1.8;
}
.preview-markdown :deep(.md-content p) {
  margin-bottom: 1.2em;
}
.preview-markdown :deep(.md-content li) {
  margin: 0.8em 0;
}
.preview-markdown :deep(.md-content li > p) {
  margin-bottom: 0;
}
.preview-markdown :deep(.md-content li > p + p) {
  margin-top: 1.2em;
}
.preview-markdown :deep(.md-content > :last-child) {
  margin-bottom: 0;
}
.preview-refresh {
  position: sticky;
  bottom: 12px;
  left: 12px;
}
</style>
