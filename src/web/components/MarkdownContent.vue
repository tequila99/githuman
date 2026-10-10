<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import { useCodeBlockCopy } from '@/composables/use-code-block-copy'
import { useMermaidBlocks } from '@/composables/use-mermaid-blocks'
import { renderMarkdown } from '@/utils/markdown'
import { usePreviewStore } from '@/stores/windows/preview-store'
import { useAgentStore } from '@/stores/agent-store'
import type { PreviewSource } from '@/types/windows/preview'

const props = withDefaults(
  defineProps<{
    text: string
    mermaidDebounce?: number
    previewSource?: PreviewSource
    previewTitle?: string
  }>(),
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

const preview = usePreviewStore()
const agents = useAgentStore()
function openDiagram(event: Event) {
  const box =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>('.agent-mermaid')
      : null
  const source = props.previewSource
  if (!box || !body.value?.contains(box) || !source) return
  const index = Number(box.dataset.diagramIndex ?? 0)
  const title =
    props.previewTitle ??
    (source.type === 'message'
      ? (agents.chats[source.sessionId]?.info.name ?? t('agent.diagram.title'))
      : source.type === 'file'
        ? source.path
        : t('windows.preview'))
  preview.open('diagram', source, {
    title: `${title} · ${t('windows.diagram')} · ${index + 1}`,
    index,
    content: box.dataset.source ?? '',
    sourceText: props.text
  })
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
  </div>
</template>
