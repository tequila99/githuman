<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import PreviewDialog from './PreviewDialog.vue'

defineProps<{ svgHtml: string }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ (e: 'hide'): void }>()
const { t } = useI18n()
</script>

<template>
  <PreviewDialog
    v-model="open"
    :title="t('agent.diagram.title')"
    @hide="emit('hide')"
  >
    <!-- Trusted: enhanceMermaidBlocks sanitizes the SVG before this snapshot is captured. -->
    <div class="mermaid-preview" v-html="svgHtml" />
  </PreviewDialog>
</template>

<style scoped>
.mermaid-preview {
  width: max-content;
  padding: 16px;
}
</style>
