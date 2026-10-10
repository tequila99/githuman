<script setup lang="ts">
import { shallowRef, watch, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuasar, useTick } from 'quasar'
import { mermaidRenderer } from '@/utils/mermaid-render'
import { sanitizeSvg, setNaturalDiagramSize } from '@/utils/mermaid-blocks'
import { errorMessage } from '@/utils/error-message'
import PreviewControls from './PreviewControls.vue'

const props = defineProps<{
  text: string
  scale: number
  visible: boolean
  overlay: HTMLElement | null
}>()
const emit = defineEmits<{ rendered: []; zoom: [delta: number] }>()
const { t } = useI18n()
const $q = useQuasar()
const { registerTick, removeTick } = useTick()
const diagram = useTemplateRef<HTMLElement>('diagram')
const svg = shallowRef('')
const error = shallowRef<string | null>(null)
const attempt = shallowRef(0)
const busy = shallowRef(true)

watch(
  () => [props.text, $q.dark.isActive, attempt.value] as const,
  async ([text, dark], _previous, onCleanup) => {
    let current = true
    onCleanup(() => {
      current = false
      removeTick()
    })
    error.value = null
    busy.value = true
    try {
      const result = await mermaidRenderer.render(text, dark)
      if (!current) return
      svg.value = sanitizeSvg(result)
      registerTick(() => {
        if (!current) return
        if (diagram.value) setNaturalDiagramSize(diagram.value)
        busy.value = false
        emit('rendered')
      })
    } catch (failure) {
      if (current) {
        error.value = errorMessage(failure)
        busy.value = false
      }
    }
  },
  { immediate: true }
)
</script>

<template>
  <div v-if="error" class="q-pa-md text-negative">
    {{ error }}<q-btn flat :label="t('windows.retry')" @click="attempt++" />
  </div>
  <div
    v-else
    ref="diagram"
    class="preview-diagram"
    :style="{ zoom: scale }"
    v-html="svg"
  />
  <Teleport v-if="overlay && visible && svg && !error" :to="overlay">
    <PreviewControls :scale="scale" :busy="busy" @zoom="emit('zoom', $event)" />
  </Teleport>
</template>

<style scoped>
.preview-diagram {
  width: max-content;
  padding: 16px;
}
.preview-diagram :deep(svg) {
  max-width: none !important;
}
</style>
