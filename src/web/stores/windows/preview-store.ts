import { PREVIEW_WINDOW_ID } from '@/constants/windows/constants'
import { ref, computed, onScopeDispose } from 'vue'
import { defineStore } from 'pinia'
import { apiGet, ApiRequestError } from '@/api/client'
import type { FileContentResponse } from '@/api/types'
import { useAgentStore } from '@/stores/agent-store'
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
import { attachmentSrc } from '@/utils/attachments'
import { localPreviewKind } from '@/utils/windows/local-preview'
import { singleFlight } from '@/utils/single-flight'
import type {
  PreviewTab,
  PreviewSource,
  PreviewData
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
  const state = windows.ensure(PREVIEW_WINDOW_ID)
  const localFiles = new Map<string, File>()
  const localUrls = new Map<string, string>()
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
    if (!state.windowSize && typeof window !== 'undefined') {
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
    title: string,
    index = 0,
    content = '',
    sourceText?: string
  ) {
    if (kind === 'diagram' && sourceText !== undefined) {
      const sources = extractDiagramSources(sourceText)
      for (const tab of tabs.value) {
        if (
          tab.kind !== 'diagram' ||
          previewSourceKey(tab.source) !== previewSourceKey(source)
        )
          continue
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
          (tab.index === index && tab.fingerprint === fingerprint))
    )
    if (existing) {
      activate(existing.id)
      return existing.id
    }
    const id = crypto.randomUUID()
    tabs.value.push({
      id,
      kind,
      source,
      title,
      index,
      fingerprint,
      scroll: { x: 0, y: 0 },
      scale: 1
    })
    data.value[id] = emptyData()
    activate(id)
    return id
  }
  function openLocal(file: File): string | null {
    const kind = localPreviewKind(file)
    if (!kind) return null
    const sourceId = crypto.randomUUID()
    localFiles.set(sourceId, file)
    return open(kind, { type: 'local', id: sourceId }, file.name)
  }
  function releaseLocal(source: PreviewSource) {
    if (source.type !== 'local') return
    if (
      tabs.value.some(
        tab => previewSourceKey(tab.source) === previewSourceKey(source)
      )
    )
      return
    localFiles.delete(source.id)
    const url = localUrls.get(source.id)
    if (url) URL.revokeObjectURL(url)
    localUrls.delete(source.id)
  }
  onScopeDispose(() => {
    for (const url of localUrls.values()) URL.revokeObjectURL(url)
    localUrls.clear()
    localFiles.clear()
  })
  function close(id: string) {
    const tab = tabs.value.find(candidate => candidate.id === id)
    const index = tabs.value.findIndex(candidate => candidate.id === id)
    tabs.value = tabs.value.filter(candidate => candidate.id !== id)
    if (tab) releaseLocal(tab.source)
    delete data.value[id]
    requests.delete(id)
    if (activeId.value === id)
      activeId.value =
        tabs.value[index]?.id ?? tabs.value[index - 1]?.id ?? null
    if (!tabs.value.length) windows.close(PREVIEW_WINDOW_ID)
    remember()
  }
  function closeAll() {
    for (const tab of tabs.value) close(tab.id)
    windows.close(PREVIEW_WINDOW_ID)
  }
  function invalidateFiles() {
    for (const tab of tabs.value) {
      if (
        tab.source.type === 'file' &&
        (tab.source.ref === 'WORKTREE' || tab.source.ref === 'INDEX')
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
        const path = tab.source.path
          .split('/')
          .map(encodeURIComponent)
          .join('/')
        const response = await apiGet<FileContentResponse>(
          `/api/git/file/${path}?ref=${encodeURIComponent(tab.source.ref)}&strict=true`
        )
        if (response.isBinary) throw new Error('The file contains binary data.')
        text = response.content
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
      if (tabs.value.includes(tab))
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
  return {
    tabs,
    activeId,
    activeTab,
    data,
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
