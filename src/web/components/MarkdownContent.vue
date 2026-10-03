<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import { useCodeBlockCopy } from '@/composables/use-code-block-copy'
import { useMermaidBlocks } from '@/composables/use-mermaid-blocks'
import { renderMarkdown } from '@/utils/markdown'
import MermaidPreviewDialog from './MermaidPreviewDialog.vue'

const props = withDefaults(
  defineProps<{ text: string; mermaidDebounce?: number }>(),
  {
    mermaidDebounce: 0
  }
)
const { t } = useI18n()
const $q = useQuasar()
const body = useTemplateRef<HTMLElement>('body')
const html = computed(() =>
  renderMarkdown(props.text, { copyLabel: t('agent.code.copy') })
)
const { copyCodeBlock } = useCodeBlockCopy(html)
useMermaidBlocks(
  body,
  html,
  () => $q.dark.isActive,
  () => t('agent.diagram.failed'),
  () => props.mermaidDebounce
)

const diagramOpen = shallowRef(false)
const diagramHtml = shallowRef('')
let diagramTarget: HTMLElement | null = null

function openDiagram(event: Event) {
  const box =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>('.agent-mermaid')
      : null
  if (!box || !body.value?.contains(box)) return
  box.focus()
  diagramTarget = box
  diagramHtml.value = box.innerHTML
  diagramOpen.value = true
}

function onDiagramHide() {
  diagramHtml.value = ''
  if (diagramTarget?.isConnected) diagramTarget.focus()
  diagramTarget = null
}

async function onClick(event: MouseEvent) {
  const button =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-copy]')
      : null
  if (!button) {
    openDiagram(event)
    return
  }
  const copied = await copyCodeBlock(button, {
    copy: t('agent.code.copy'),
    copied: t('agent.code.copied')
  })
  if (!copied)
    $q.notify({ type: 'negative', message: t('agent.code.copyFailed') })
}
</script>

<template>
  <div>
    <!-- Trusted: renderMarkdown escapes raw HTML and rejects unsafe URLs. -->
    <div
      ref="body"
      class="md-content"
      @click="onClick"
      @keydown.enter="openDiagram"
      v-html="html"
    />
    <MermaidPreviewDialog
      v-model="diagramOpen"
      :svg-html="diagramHtml"
      @hide="onDiagramHide"
    />
  </div>
</template>
