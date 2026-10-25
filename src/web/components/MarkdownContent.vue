<script setup lang="ts">
import { computed, useTemplateRef, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import { useCodeBlockCopy } from '@/composables/use-code-block-copy'
import { useMermaidBlocks } from '@/composables/use-mermaid-blocks'
import { renderMarkdown } from '@/utils/markdown'
import { usePreviewStore } from '@/stores/windows/preview-store'
import { useAgentStore } from '@/stores/agent-store'
import { errorMessage } from '@/utils/error-message'
import { useProjectFilesStore } from '@/stores/project-files-store'
import {
  parseProjectFileLink,
  projectFileFromQuery,
  projectFileRoute
} from '@/utils/windows/project-file-link'
import { useRepositoryStore } from '@/stores/repository-store'
import { PROJECT_FILE_ROUTE } from '@/constants/project-files'
import { WORKTREE_REF } from '@/constants/git'
import type { PreviewSource } from '@/types/windows/preview'

// Start of every link that this component opens in the preview window.
const OPEN_ROUTE_PREFIX = PROJECT_FILE_ROUTE + '?'

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
const router = useRouter()
const $q = useQuasar()
const body = useTemplateRef<HTMLElement>('body')
const preview = usePreviewStore()
const agents = useAgentStore()
const repository = useRepositoryStore()
const projectFiles = useProjectFilesStore()
const html = computed(() =>
  renderMarkdown(props.text, {
    copyLabel: t('agent.code.copy'),
    headingAnchors: props.headingAnchors,
    fileLink: props.fileLinks ? rewriteFileLink : undefined
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

watchEffect(() => {
  if (props.fileLinks && !projectFiles.ready) {
    void projectFiles.prepare().catch(() => {})
  }
})
function rewriteFileLink(href: string): string {
  if (!repository.info || !projectFiles.ready) return href
  const source = props.previewSource
  try {
    const link = parseProjectFileLink(href, {
      repositoryPath: repository.info.path,
      origin: window.location.origin,
      origins: projectFiles.origins,
      from: source?.type === 'file' ? source.path : ''
    })
    return link
      ? router.resolve(
          projectFileRoute(
            link,
            source?.type === 'file' ? source.ref : WORKTREE_REF
          )
        ).href
      : href
  } catch {
    return router.resolve(PROJECT_FILE_ROUTE + '?invalid=true').href
  }
}
async function openFileLink(event: MouseEvent): Promise<boolean> {
  if (!props.fileLinks) return false
  const anchor =
    event.target instanceof Element ? event.target.closest('a') : null
  if (!anchor || !body.value?.contains(anchor)) return false
  const href = anchor.getAttribute('href') ?? ''
  const url = new URL(href, window.location.href)
  const target = url.hash.startsWith('#' + OPEN_ROUTE_PREFIX)
    ? url.hash.slice(1)
    : url.pathname + url.search
  if (
    url.origin !== window.location.origin ||
    !target.startsWith(OPEN_ROUTE_PREFIX)
  ) {
    return false
  }
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0
  ) {
    return true
  }
  event.preventDefault()
  try {
    const query = new URL(target, window.location.origin).searchParams
    const request = projectFileFromQuery(key => query.get(key))
    if (!request) throw new Error(t('windows.fileLinkFailed'))
    await projectFiles.open(request.link, request.ref)
  } catch (failure) {
    $q.notify({ type: 'negative', message: errorMessage(failure) })
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
