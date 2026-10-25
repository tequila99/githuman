import { PREVIEW_WINDOW_ID } from '@/constants/windows/constants'
import { isNarrowWorkspace } from '@/utils/workspace-navigation'
import { ref, computed, onScopeDispose } from 'vue'
import { defineStore } from 'pinia'
import { Screen, uid } from 'quasar'
import { apiGet, apiGetBlob, ApiRequestError } from '@/api/client'
import type { FileContentResponse } from '@/api/types'
import { useAgentStore } from '@/stores/agent-store'
import { afterWindowTransition } from '@/utils/windows/window-elements'
import { useWindowStore } from './window-store'
import { safeStorage } from '@/utils/safe-storage'
import { isRecord } from '@/utils/guards'
import { errorMessage } from '@/utils/error-message'
import { extractDiagramSources } from '@/utils/markdown'
import {
  previewSourceKey,
  previewFingerprint,
  parsePreviewTab,
  findDiagram
} from '@/utils/windows/preview-source'
import { projectFileContentUrl } from '@/utils/windows/project-file-link'
import { WORKTREE_REF } from '@/constants/git'
import { attachmentSrc } from '@/utils/attachments'
import { localPreviewKind } from '@/utils/windows/local-preview'
import { singleFlight } from '@/utils/single-flight'
import type {
  PreviewTab,
  PreviewSource,
  PreviewData,
  PreviewOpenOptions
} from '@/types/windows/preview'

// Preferences contain source locators only; documents and attachments remain at their sources.
const STORAGE_KEY = 'githuman:preview:v1'
// Reject preferences written with an incompatible schema.
const STORAGE_VERSION = 1
// The initial preview occupies three quarters of the viewport.
const DEFAULT_VIEWPORT_RATIO = 0.75
// Equal margins center the initial preview in the viewport.
const DEFAULT_POSITION_RATIO = (1 - DEFAULT_VIEWPORT_RATIO) / 2

function emptyData(): PreviewData {
  return {
    text: '',
    image: '',
    pdf: null,
    loading: false,
    error: null,
    missing: null,
    loaded: false,
    stale: true
  }
}
export const usePreviewStore = defineStore('preview', () => {
  const windows = useWindowStore()
  const tabs = ref<PreviewTab[]>([])
  const activeId = ref<string | null>(null)
  const data = ref<Record<string, PreviewData>>({})
  const anchorRequests = ref<Record<string, string>>({})
  // One-shot request to scroll a text tab to its line; it is never persisted.
  const lineRequests = ref<Record<string, true>>({})
  const state = windows.ensure(PREVIEW_WINDOW_ID)
  const localFiles = new Map<string, File>()
  const localUrls = new Map<string, string>()
  const fileControllers = new Map<string, AbortController>()
  const fileUrls = new Map<string, string>()
  const requests = new Map<string, () => Promise<void>>()
  try {
    const saved: unknown = JSON.parse(safeStorage.get(STORAGE_KEY) ?? 'null')
    if (
      isRecord(saved) &&
      saved.version === STORAGE_VERSION &&
      Array.isArray(saved.tabs)
    ) {
      const seen = new Set<string>()
      tabs.value = saved.tabs.flatMap(value => {
        const tab = parsePreviewTab(value)
        if (!tab || seen.has(tab.id)) return []
        seen.add(tab.id)
        data.value[tab.id] = emptyData()
        return [tab]
      })
      activeId.value =
        typeof saved.activeId === 'string' && seen.has(saved.activeId)
          ? saved.activeId
          : (tabs.value[0]?.id ?? null)
    }
  } catch {
    /* Invalid preferences do not prevent preview access. */
  }
  const activeTab = computed(() =>
    tabs.value.find(tab => tab.id === activeId.value)
  )
  function remember() {
    safeStorage.set(
      STORAGE_KEY,
      JSON.stringify({
        version: STORAGE_VERSION,
        tabs: tabs.value.filter(tab => tab.source.type !== 'local'),
        activeId: activeId.value
      })
    )
  }
  function show() {
    if (
      !state.windowSize &&
      typeof window !== 'undefined' &&
      !isNarrowWorkspace(Screen.width)
    ) {
      state.windowSize = {
        width: window.innerWidth * DEFAULT_VIEWPORT_RATIO,
        height: window.innerHeight * DEFAULT_VIEWPORT_RATIO
      }
      state.position = {
        x: window.innerWidth * DEFAULT_POSITION_RATIO,
        y: window.innerHeight * DEFAULT_POSITION_RATIO
      }
    }
    windows.focus(PREVIEW_WINDOW_ID)
  }
  function activate(id: string) {
    activeId.value = id
    show()
    remember()
  }
  function open(
    kind: PreviewTab['kind'],
    source: PreviewSource,
    {
      title,
      index = 0,
      content = '',
      sourceText,
      anchor,
      line,
      column
    }: PreviewOpenOptions
  ) {
    if (kind === 'diagram' && sourceText !== undefined) {
      const sources = extractDiagramSources(sourceText)
      for (const tab of tabs.value) {
        if (
          tab.kind !== 'diagram' ||
          previewSourceKey(tab.source) !== previewSourceKey(source)
        ) {
          continue
        }
        const position = findDiagram(sources, tab.index, tab.fingerprint)
        if (position < 0) continue
        tab.index = position
        tab.fingerprint = previewFingerprint(sources[position]!)
        tab.title = tab.title.replace(/ · \d+$/, ` · ${position + 1}`)
      }
    }
    const fingerprint = previewFingerprint(content)
    if (kind === 'diagram' && content) {
      // An edited diagram at the same position still belongs to its existing tab.
      const samePosition = tabs.value.find(
        tab =>
          tab.kind === kind &&
          previewSourceKey(tab.source) === previewSourceKey(source) &&
          tab.index === index
      )
      if (samePosition) {
        samePosition.fingerprint = fingerprint
        samePosition.title = title
        runtime(samePosition.id).stale = true
        activate(samePosition.id)
        return samePosition.id
      }
    }
    const existing = tabs.value.find(
      tab =>
        tab.kind === kind &&
        previewSourceKey(tab.source) === previewSourceKey(source) &&
        (kind === 'markdown' ||
          kind === 'text' ||
          kind === 'pdf' ||
          (kind === 'image' && source.type !== 'message') ||
          (tab.index === index && tab.fingerprint === fingerprint))
    )
    if (existing) {
      if (anchor) {
        anchorRequests.value[existing.id] = anchor
      } else if (anchor !== undefined) {
        delete anchorRequests.value[existing.id]
      }
      existing.line = line
      existing.column = column
      if (line) lineRequests.value[existing.id] = true
      activate(existing.id)
      return existing.id
    }
    // `crypto.randomUUID` is missing on plain HTTP from the network. Quasar `uid` works there.
    const id = uid()
    tabs.value.push({
      id,
      kind,
      source,
      title,
      index,
      fingerprint,
      scroll: { x: 0, y: 0 },
      line,
      column,
      scale: 1
    })
    data.value[id] = emptyData()
    if (anchor) anchorRequests.value[id] = anchor
    if (line) lineRequests.value[id] = true
    activate(id)
    return id
  }
  function openLocal(file: File): string | null {
    const kind = localPreviewKind(file)
    if (!kind) return null
    const sourceId = uid()
    localFiles.set(sourceId, file)
    return open(kind, { type: 'local', id: sourceId }, { title: file.name })
  }
  function releaseLocal(source: PreviewSource) {
    if (source.type !== 'local') return
    if (
      tabs.value.some(
        tab => previewSourceKey(tab.source) === previewSourceKey(source)
      )
    ) {
      return
    }
    localFiles.delete(source.id)
    const url = localUrls.get(source.id)
    if (url) URL.revokeObjectURL(url)
    localUrls.delete(source.id)
  }
  onScopeDispose(() => {
    for (const controller of fileControllers.values()) controller.abort()
    for (const url of fileUrls.values()) URL.revokeObjectURL(url)
    for (const url of localUrls.values()) URL.revokeObjectURL(url)
    localUrls.clear()
    localFiles.clear()
  })
  function close(id: string) {
    fileControllers.get(id)?.abort()
    fileControllers.delete(id)
    const fileUrl = fileUrls.get(id)
    if (fileUrl) URL.revokeObjectURL(fileUrl)
    fileUrls.delete(id)
    const tab = tabs.value.find(candidate => candidate.id === id)
    const index = tabs.value.findIndex(candidate => candidate.id === id)
    if (tab && tabs.value.length === 1) windows.close(PREVIEW_WINDOW_ID)
    tabs.value = tabs.value.filter(candidate => candidate.id !== id)
    if (tab) {
      afterWindowTransition(PREVIEW_WINDOW_ID, () => releaseLocal(tab.source))
    }
    delete data.value[id]
    delete anchorRequests.value[id]
    delete lineRequests.value[id]
    requests.delete(id)
    if (activeId.value === id) {
      activeId.value =
        tabs.value[index]?.id ?? tabs.value[index - 1]?.id ?? null
    }
    if (!tabs.value.length) windows.close(PREVIEW_WINDOW_ID)
    remember()
  }
  function closeAll() {
    windows.close(PREVIEW_WINDOW_ID)
    for (const tab of tabs.value) close(tab.id)
  }
  function invalidateFiles() {
    for (const tab of tabs.value) {
      if (
        tab.source.type === 'file' &&
        (tab.source.ref === WORKTREE_REF || tab.source.ref === 'INDEX')
      ) {
        runtime(tab.id).stale = true
      }
    }
  }
  function runtime(id: string) {
    return (data.value[id] ??= emptyData())
  }
  function load(id: string): Promise<void> {
    let request = requests.get(id)
    if (!request) {
      request = singleFlight(() => doLoad(id))
      requests.set(id, request)
    }
    return request()
  }
  async function doLoad(id: string) {
    const tab = tabs.value.find(item => item.id === id)
    if (!tab) return
    const entry = runtime(id)
    entry.loading = true
    entry.stale = false
    let text = ''
    let image = ''
    let pdf: File | null = null
    let missing: PreviewData['missing'] = null
    let error: string | null = null
    const controller = new AbortController()
    fileControllers.set(id, controller)
    try {
      if (tab.source.type === 'local') {
        const file = localFiles.get(tab.source.id)
        if (!file) {
          missing = 'file'
        } else if (tab.kind === 'markdown' || tab.kind === 'diagram') {
          text = await file.text()
        } else if (tab.kind === 'pdf') {
          pdf = file
        } else {
          let url = localUrls.get(tab.source.id)
          if (!url) {
            url = URL.createObjectURL(file)
            localUrls.set(tab.source.id, url)
          }
          image = url
        }
      } else if (tab.source.type === 'file') {
        if (tab.source.ref === WORKTREE_REF) {
          const blob = await apiGetBlob(
            projectFileContentUrl(tab.source.path),
            controller.signal
          )
          if (tab.kind === 'pdf') {
            pdf = new File([blob], tab.source.path, { type: blob.type })
          } else if (tab.kind === 'image') {
            if (tabs.value.includes(tab)) {
              const old = fileUrls.get(id)
              if (old) URL.revokeObjectURL(old)
              image = URL.createObjectURL(blob)
              fileUrls.set(id, image)
            }
          } else {
            text = await blob.text()
          }
        } else {
          if (tab.kind === 'pdf' || tab.kind === 'image') {
            throw new Error(`Binary previews require ${WORKTREE_REF}`)
          }
          const path = tab.source.path
            .split('/')
            .map(encodeURIComponent)
            .join('/')
          const response = await apiGet<FileContentResponse>(
            `/api/git/file/${path}?ref=${encodeURIComponent(tab.source.ref)}&strict=true`
          )
          if (response.isBinary) {
            missing = 'binary'
          } else {
            text = response.content
          }
        }
      } else {
        const chat = useAgentStore().chats[tab.source.sessionId]
        const source = tab.source
        const item = chat?.chat.items.find(
          candidate => candidate.id === source.messageId
        )
        if (!item) {
          missing = 'message'
        } else if (tab.kind === 'image') {
          const attachment =
            item.kind === 'user' ? item.context[tab.index] : undefined
          if (
            !attachment ||
            attachment.kind !== 'attachment' ||
            !attachment.mimeType.startsWith('image/') ||
            previewFingerprint(attachment.data) !== tab.fingerprint
          ) {
            missing = 'attachment'
          } else {
            image = attachmentSrc(attachment)
          }
        } else if ('text' in item) {
          text = item.text
        } else {
          missing = 'message'
        }
      }
      if (tab.kind === 'diagram' && !missing) {
        const sources = extractDiagramSources(text)
        const index = findDiagram(sources, tab.index, tab.fingerprint)
        if (index < 0) {
          missing = 'diagram'
        } else {
          tab.index = index
          text = sources[index]!
          tab.fingerprint = previewFingerprint(text)
          tab.title = tab.title.replace(/ · \d+$/, ` · ${index + 1}`)
          remember()
        }
      }
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 404) {
        missing = 'file'
      } else {
        error = errorMessage(failure)
      }
    } finally {
      if (fileControllers.get(id) === controller) fileControllers.delete(id)
      if (tabs.value.includes(tab)) {
        Object.assign(entry, {
          text,
          image,
          pdf,
          missing,
          error,
          loading: false,
          loaded: true
        })
      }
    }
  }
  return {
    tabs,
    activeId,
    activeTab,
    data,
    anchorRequests,
    lineRequests,
    show,
    open,
    openLocal,
    activate,
    close,
    closeAll,
    remember,
    runtime,
    load,
    invalidateFiles
  }
})
