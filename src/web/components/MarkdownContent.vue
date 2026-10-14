<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import { useCodeBlockCopy } from '@/composables/use-code-block-copy'
import { useMermaidBlocks } from '@/composables/use-mermaid-blocks'
import { renderMarkdown } from '@/utils/markdown'
import { usePreviewStore } from '@/stores/windows/preview-store'
import { useAgentStore } from '@/stores/agent-store'
import { useRepositoryStore } from '@/stores/repository-store'
import {
  parseMarkdownFileLink,
  resolveMarkdownFileLink
} from '@/utils/windows/markdown-file-link'
import type { PreviewSource } from '@/types/windows/preview'

const props = withDefaults(
  defineProps<{
    text: string
    headingAnchors?: boolean
    mermaidDebounce?: number
    previewSource?: PreviewSource
    previewTitle?: string
    fileLinks?: boolean
  }>(),
  {
    mermaidDebounce: 0
  }
)
const { t } = useI18n()
const $q = useQuasar()
const body = useTemplateRef<HTMLElement>('body')
const html = computed(() =>
  renderMarkdown(props.text, {
    copyLabel: t('agent.code.copy'),
    headingAnchors: props.headingAnchors
  })
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
const repository = useRepositoryStore()
async function openFileLink(event: MouseEvent): Promise<boolean> {
  if (!props.fileLinks) return false
  const anchor =
    event.target instanceof Element ? event.target.closest('a') : null
  if (!anchor || !body.value?.contains(anchor)) return false
  const href = anchor.getAttribute('href') ?? ''
  try {
    const link = parseMarkdownFileLink(href)
    if (!link) return false
    event.preventDefault()
    if (!repository.info) await repository.fetchInfo()
    if (!repository.info) {
      $q.notify({
        type: 'negative',
        message: repository.error ?? t('windows.fileLinkFailed')
      })
      return true
    }
    const source = props.previewSource
    const path = resolveMarkdownFileLink(
      link,
      repository.info.path,
      source?.type === 'file' ? source.path : ''
    )
    preview.open(
      'markdown',
      {
        type: 'file',
        path,
        ref: source?.type === 'file' ? source.ref : 'WORKTREE'
      },
      {
        title: path,
        anchor: link.anchor
      }
    )
  } catch {
    event.preventDefault()
    $q.notify({ type: 'negative', message: t('windows.fileLinkFailed') })
  }
  return true
}
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
  if (event.defaultPrevented || (await openFileLink(event))) return
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
  if (!copied) {
    $q.notify({ type: 'negative', message: t('agent.code.copyFailed') })
  }
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
