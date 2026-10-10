<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePdfRenderer } from '@/composables/preview/use-pdf-renderer'
import { usePdfNavigation } from '@/composables/preview/use-pdf-navigation'
import PreviewControls from './PreviewControls.vue'

const props = defineProps<{
  file: File
  scale: number
  overlay: HTMLElement | null
}>()
const pageIndex = defineModel<number>('page', { required: true })
const emit = defineEmits<{
  remember: []
  rendered: []
  zoom: [delta: number]
}>()
const { t } = useI18n()
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const { pages, busy, error } = usePdfRenderer({
  file: () => props.file,
  canvas,
  page: pageIndex,
  scale: () => props.scale,
  onRendered: () => emit('rendered')
})
const { navigate, navigateFromMargin } = usePdfNavigation({
  page: pageIndex,
  pages,
  canvas,
  blocked: () => busy.value || !!error.value,
  onNavigate: () => emit('remember')
})
</script>

<template>
  <div class="pdf-preview" @click="navigateFromMargin">
    <Teleport v-if="overlay" :to="overlay">
      <PreviewControls
        :page="pages ? pageIndex + 1 : 0"
        :pages="pages"
        :scale="scale"
        :busy="busy"
        @navigate="navigate"
        @zoom="emit('zoom', $event)"
      />
    </Teleport>
    <div v-if="error" class="q-pa-md text-negative">{{ error }}</div>
    <canvas
      ref="canvas"
      class="pdf-preview__page"
      :aria-label="t('windows.pdfPage', { page: pageIndex + 1 })"
    />
  </div>
</template>

<style scoped>
.pdf-preview {
  min-height: 100%;
  min-width: 100%;
  width: max-content;
  padding: 16px;
}
.pdf-preview__page {
  display: block;
  margin: 0 auto;
}
</style>
