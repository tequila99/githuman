import {
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter
} from 'vue'
import PQueue from 'p-queue'
import { notesApi } from '@/api/notes'
import { createWeightedLru } from '@/utils/weighted-lru'
import { errorMessage } from '@/utils/error-message'
import {
  externalNoteAssets,
  invertExternalAssetEdits,
  replaceExternalNoteAssets,
  type ExternalAssetEdit,
  type ExternalNoteAsset
} from '../../../shared/notes/external-assets.ts'
import { MAX_NOTE_IMPORT_BYTES } from '../../../shared/notes/constants.ts'

// Bound the memory that decoded previews keep in the browser.
const PREVIEW_BUDGET_BYTES = 100_000_000
// Keep the server queue short: it rejects requests when it is full.
const REQUEST_CONCURRENCY = 3

interface PreviewEntry {
  url: string
  bytes: number
}

export interface ExternalAssetRow extends ExternalNoteAsset {
  selected: boolean
  size: number | null
  preview: string
  previewState: 'idle' | 'loading' | 'error'
  inspected: boolean
  state:
    | 'pending'
    | 'loading'
    | 'confirmation'
    | 'stored'
    | 'done'
    | 'error'
    | 'skipped'
  error: string
  reason: string
  localUrl: string
}
interface AssetDraft {
  id?: string
  storageId?: string
  path: string
  text: string
  deleted?: boolean
  status: string
}

export function useNoteExternalAssets(
  source: MaybeRefOrGetter<AssetDraft>,
  options: {
    apply: (text: string, edits: ExternalAssetEdit[]) => void
    empty: () => void
    api?: Pick<
      typeof notesApi,
      'inspectExternalAsset' | 'importExternalAsset' | 'previewExternalAsset'
    >
    protocol?: string
  }
) {
  const api = options.api ?? notesApi
  const protocol = options.protocol ?? 'https:'
  const opened = shallowRef(false)
  const busy = shallowRef(false)
  const rows = ref<ExternalAssetRow[]>([])
  const replacements = shallowRef(0)
  const before = shallowRef('')
  const after = shallowRef<string | null>(null)
  const requests = new PQueue({ concurrency: REQUEST_CONCURRENCY })
  const previews = createWeightedLru<string, PreviewEntry>(
    PREVIEW_BUDGET_BYTES,
    entry => entry.bytes,
    (url, entry) => {
      URL.revokeObjectURL(entry.url)
      const row = rows.value.find(item => item.url === url)
      if (row) {
        row.preview = ''
        row.previewState = 'idle'
      }
    }
  )
  let generation = 0
  let controller = new AbortController()
  let confirmation: ((allow: boolean) => void) | undefined
  let usedBytes = 0
  let lastApplied = new Set<string>()
  let reverseEdits: ExternalAssetEdit[] = []
  const identity = () => {
    const draft = toValue(source)
    return JSON.stringify([
      draft.storageId,
      draft.id ?? draft.path,
      Boolean(draft.deleted),
      draft.status === 'conflict'
    ])
  }
  const canRestore = computed(
    () =>
      after.value !== null &&
      toValue(source).text === after.value &&
      !busy.value &&
      toValue(source).status !== 'conflict' &&
      !toValue(source).deleted
  )
  function revoke() {
    previews.clear()
  }
  function invalidate() {
    generation++
    controller.abort()
    confirmation?.(false)
    confirmation = undefined
    revoke()
    opened.value = false
    after.value = null
  }
  watch(identity, invalidate, { flush: 'sync' })
  onScopeDispose(invalidate)
  function open() {
    if (opened.value || busy.value) return
    const draft = toValue(source)
    if (draft.deleted || draft.status === 'conflict') return
    let candidates: ExternalNoteAsset[]
    try {
      candidates = externalNoteAssets(draft.text, protocol)
    } catch {
      candidates = []
    }
    if (!candidates.length) {
      options.empty()
      return
    }
    invalidate()
    controller = new AbortController()
    rows.value = candidates.map(item => ({
      ...item,
      selected: true,
      size: null,
      preview: '',
      previewState: 'idle',
      inspected: false,
      state: 'pending',
      error: '',
      reason: '',
      localUrl: ''
    }))
    usedBytes = 0
    replacements.value = 0
    opened.value = true
  }
  async function inspect(row: ExternalAssetRow) {
    if (!opened.value) return
    if (row.kind === 'pdf') {
      await inspectSize(row)
    } else {
      await loadPreview(row)
    }
  }
  async function inspectSize(row: ExternalAssetRow) {
    if (row.inspected) return
    row.inspected = true
    const current = generation
    const signal = controller.signal
    try {
      const value = await requests.add(
        () => api.inspectExternalAsset(row.url, signal),
        { signal }
      )
      if (current === generation) row.size = value.size
    } catch {
      // The size stays unknown; the download reports real failures.
    }
  }
  // One request gives the image and its size. A row that comes back into view
  // after eviction loads again.
  async function loadPreview(row: ExternalAssetRow) {
    if (previews.get(row.url)) return
    if (row.previewState === 'loading') return
    row.previewState = 'loading'
    const current = generation
    const signal = controller.signal
    try {
      const blob = await requests.add(
        () => api.previewExternalAsset(row.url, signal),
        { signal }
      )
      if (current !== generation || signal.aborted) return
      const url = URL.createObjectURL(blob)
      row.size ??= blob.size
      row.preview = url
      row.previewState = 'idle'
      previews.set(row.url, { url, bytes: blob.size })
    } catch {
      if (current === generation && !signal.aborted) row.previewState = 'error'
    }
  }
  function confirm(allow: boolean) {
    confirmation?.(allow)
    confirmation = undefined
  }
  function close() {
    controller.abort()
    confirm(false)
    opened.value = false
    revoke()
  }
  async function download() {
    if (busy.value) return
    busy.value = true
    after.value = null
    const current = generation
    const key = identity()
    const signal = controller.signal
    const successful = new Map<string, string>()
    try {
      for (const row of rows.value) {
        if (signal.aborted || current !== generation) break
        if (!row.selected || row.state === 'done' || row.state === 'stored') {
          continue
        }
        row.state = 'loading'
        row.error = ''
        row.reason = ''
        try {
          let allowLargePdf = false
          while (true) {
            if (usedBytes >= MAX_NOTE_IMPORT_BYTES) {
              row.state = 'error'
              row.reason = 'operation-limit'
              break
            }
            const result = await api.importExternalAsset(
              {
                url: row.url,
                kind: row.kind,
                allowLargePdf,
                remainingBytes: MAX_NOTE_IMPORT_BYTES - usedBytes
              },
              signal
            )
            if (current !== generation || signal.aborted) break
            if (result.status === 'confirmation-required') {
              row.state = 'confirmation'
              row.size = result.size
              allowLargePdf = await new Promise<boolean>(resolve => {
                confirmation = resolve
              })
              if (!allowLargePdf || signal.aborted) {
                row.state = 'skipped'
                break
              }
              row.state = 'loading'
            } else if (result.status === 'stored') {
              row.state = 'stored'
              row.localUrl = result.url
              row.size = result.bytes
              usedBytes += result.bytes
              successful.set(row.url, result.url)
              break
            } else {
              row.state = 'error'
              row.reason = result.reason
              break
            }
          }
        } catch (error) {
          if (signal.aborted || current !== generation) break
          row.state = 'error'
          row.error = errorMessage(error)
        }
      }
      if (current === generation && key === identity() && successful.size) {
        const draft = toValue(source)
        const result = replaceExternalNoteAssets(
          draft.text,
          successful,
          protocol
        )
        const currentUrls = new Set(
          externalNoteAssets(draft.text, protocol).map(item => item.url)
        )
        if (result.count) {
          lastApplied = new Set(successful.keys())
          before.value = draft.text
          reverseEdits = invertExternalAssetEdits(draft.text, result.edits)
          options.apply(result.text, result.edits)
          after.value = result.text
          replacements.value += result.count
        }
        for (const row of rows.value) {
          if (row.state === 'stored') {
            row.state = currentUrls.has(row.url) ? 'done' : 'skipped'
          }
        }
      }
    } finally {
      if (current === generation) {
        for (const row of rows.value) {
          if (row.state === 'loading') row.state = 'pending'
        }
      }
      busy.value = false
    }
  }
  function restore() {
    if (!canRestore.value) return
    options.apply(before.value, reverseEdits)
    after.value = null
    replacements.value = 0
    for (const row of rows.value) {
      if (row.state === 'done' && lastApplied.has(row.url)) {
        row.state = 'pending'
        row.localUrl = ''
      }
    }
  }
  function selectAll(value: boolean) {
    for (const row of rows.value) row.selected = value
  }
  return {
    opened,
    busy,
    rows,
    replacements,
    canRestore,
    open,
    close,
    inspect,
    confirm,
    download,
    restore,
    selectAll
  }
}
