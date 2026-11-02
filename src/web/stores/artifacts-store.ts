import { loadArtifactBody } from '@/utils/artifact-content'
import { shallowRef } from 'vue'
import { defineStore, acceptHMRUpdate } from 'pinia'
import { artifactsApi } from '@/api/artifacts'
import { ApiRequestError } from '@/api/client'
import type {
  Artifact,
  ArtifactSearchInput,
  ArtifactSearchResult
} from '@/api/types'
import { errorMessage } from '@/utils/error-message'
import { singleFlight } from '@/utils/single-flight'
import {
  classifyContentError,
  type ArtifactContentErrorKind,
  type ArtifactContentState
} from '@/utils/artifact-content-state'

// Bound automatic catch-up work while preserving deliberate deep browsing.
const MAX_CATCH_UP_PAGES = 5

/** Identity of a verified body; the catalog hash alone cannot prove a read. */
function identityKey(metadata: Artifact): string {
  return [
    metadata.storeId,
    metadata.id,
    metadata.sha256,
    metadata.bytes,
    metadata.bodyStartLine
  ].join(':')
}

export const useArtifactsStore = defineStore('artifacts', () => {
  const storeId = shallowRef<string | null>(null)
  const input = shallowRef<ArtifactSearchInput>({})
  const catalog = shallowRef<ArtifactSearchResult | null>(null)
  const loading = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const stale = shallowRef(false)
  const document = shallowRef<Artifact | null>(null)
  const body = shallowRef('')
  const documentLoading = shallowRef(false)
  const documentError = shallowRef<string | null>(null)
  const selection = shallowRef<{ storeId: string; id: string } | null>(null)
  // Content has its own state: metadata stay usable when the file cannot be read.
  const contentState = shallowRef<ArtifactContentState>('idle')
  const contentError = shallowRef<string | null>(null)
  const contentErrorKind = shallowRef<ArtifactContentErrorKind | null>(null)
  // True while an already verified body is checked again; the state stays ready.
  const verifying = shallowRef(false)
  let enabled = true
  // Identity of the body that was read and verified.
  let verifiedKey: string | null = null
  // A user request to read the body again; the next document load consumes it.
  let forceNext = false
  let catalogGeneration = 0
  let loadedPages = 1
  let documentGeneration = 0
  let contentAbort: AbortController | null = null

  const refresh = singleFlight(async () => {
    if (!enabled) return
    const generation = ++catalogGeneration
    const request = input.value
    loading.value = true
    error.value = null
    try {
      if (loadedPages > MAX_CATCH_UP_PAGES) {
        throw new Error(
          'Too many loaded pages to refresh automatically. Reload the catalog.'
        )
      }
      const depth = loadedPages
      const first = await artifactsApi.search(request)
      if (generation !== catalogGeneration) return
      let result = first
      let pages = 1
      while (pages < depth) {
        if (!result.nextCursor) {
          result = first
          pages = 1
          break
        }
        let next: ArtifactSearchResult
        try {
          next = await artifactsApi.search({
            ...request,
            cursor: result.nextCursor
          })
        } catch (failure) {
          // The server rejects a cursor if its epoch changes during this traversal.
          if (!(failure instanceof ApiRequestError) || failure.status !== 409) {
            throw failure
          }
          result = first
          pages = 1
          break
        }
        if (generation !== catalogGeneration) return
        if (
          next.storeId !== first.storeId ||
          next.storeEpoch !== first.storeEpoch ||
          next.indexEpoch !== first.indexEpoch ||
          !next.items.length
        ) {
          result = first
          pages = 1
          break
        }
        result = { ...next, items: [...result.items, ...next.items] }
        ++pages
      }
      if (generation !== catalogGeneration) return
      loadedPages = pages
      storeId.value = result.storeId
      catalog.value = result
      stale.value = false
    } catch (err) {
      if (generation !== catalogGeneration) return
      error.value = errorMessage(err)
      stale.value = catalog.value !== null
    } finally {
      if (generation === catalogGeneration) loading.value = false
    }
  })

  function search(value: ArtifactSearchInput) {
    enabled = true
    input.value = value
    stale.value = false
    ++catalogGeneration
    catalog.value = null
    loadedPages = 1
    return refresh()
  }

  function reload() {
    loadedPages = 1
    ++catalogGeneration
    return refresh()
  }

  async function loadMore() {
    if (loading.value || stale.value || !catalog.value?.nextCursor) return
    const generation = catalogGeneration
    const previous = catalog.value
    loading.value = true
    error.value = null
    try {
      const next = await artifactsApi.search({
        ...input.value,
        cursor: previous.nextCursor!
      })
      if (generation !== catalogGeneration) return
      if (
        next.storeId !== previous.storeId ||
        next.storeEpoch !== previous.storeEpoch ||
        next.indexEpoch !== previous.indexEpoch
      ) {
        throw new Error('The artifact catalog changed. Refresh the list.')
      }
      catalog.value = { ...next, items: [...previous.items, ...next.items] }
      ++loadedPages
    } catch (err) {
      if (generation !== catalogGeneration) return
      error.value = errorMessage(err)
      stale.value = true
    } finally {
      if (generation === catalogGeneration) loading.value = false
    }
  }

  function resetContent() {
    body.value = ''
    verifiedKey = null
    contentState.value = 'idle'
    contentError.value = null
    contentErrorKind.value = null
    verifying.value = false
  }

  async function load(
    value: { storeId: string; id: string } | null,
    force: boolean
  ) {
    selection.value = value
    const generation = ++documentGeneration
    contentAbort?.abort()
    const retained =
      document.value?.id === value?.id &&
      document.value?.storeId === value?.storeId
        ? document.value
        : null
    if (!retained) {
      document.value = null
      resetContent()
    }
    documentError.value = null
    documentLoading.value = Boolean(value)
    if (!value) return
    const controller = new AbortController()
    contentAbort = controller
    try {
      const metadata = await artifactsApi.get(value.id, controller.signal)
      if (generation !== documentGeneration) return
      if (metadata.storeId !== value.storeId || metadata.id !== value.id) {
        throw new Error('This document belongs to another artifact store.')
      }
      // Metadata are shown at once; the body follows under its own state.
      document.value = metadata
      const key = identityKey(metadata)
      const verified = contentState.value === 'ready' && verifiedKey === key
      if (!force && verified) return
      // After a failed read only an explicit retry reads again.
      if (!force && contentState.value === 'error') return
      if (verified) {
        verifying.value = true
      } else {
        body.value = ''
        verifiedKey = null
        contentState.value = 'loading'
      }
      contentError.value = null
      contentErrorKind.value = null
      try {
        const text = await loadArtifactBody(metadata, controller.signal)
        if (generation !== documentGeneration) return
        body.value = text
        verifiedKey = key
        contentState.value = 'ready'
      } catch (err) {
        if (generation !== documentGeneration) return
        const kind = classifyContentError(err)
        if (kind === 'abort') return
        // A failed check removes the body: it is no longer proven to be sound.
        body.value = ''
        verifiedKey = null
        contentState.value = 'error'
        contentError.value = errorMessage(err)
        contentErrorKind.value = kind
      }
    } catch (err) {
      if (generation === documentGeneration) {
        documentError.value = errorMessage(err)
        // The aborted read of an earlier load cannot leave a spinner behind.
        if (contentState.value === 'loading') {
          contentState.value = 'idle'
        }
      }
    } finally {
      if (generation === documentGeneration) {
        documentLoading.value = false
        verifying.value = false
      }
    }
  }

  function select(value: { storeId: string; id: string } | null) {
    // A request for another document must not force a read of this one.
    forceNext = false
    return load(value, false)
  }

  const refreshDocument = singleFlight(async () => {
    if (!enabled) return
    const force = forceNext
    forceNext = false
    await load(selection.value, force)
  })

  /** Reads and verifies the body again, even when the catalog hash is unchanged. */
  function retryContent() {
    // A stopped store must not keep a request that a later search would wake up.
    if (!enabled) {
      return Promise.resolve()
    }
    forceNext = true
    return refreshDocument()
  }

  function cancel() {
    enabled = false
    forceNext = false
    ++catalogGeneration
    ++documentGeneration
    contentAbort?.abort()
    loading.value = false
    documentLoading.value = false
    verifying.value = false
    if (contentState.value === 'loading') {
      contentState.value = 'idle'
    }
  }

  return {
    storeId,
    input,
    catalog,
    loading,
    error,
    stale,
    document,
    body,
    documentLoading,
    documentError,
    contentState,
    contentError,
    contentErrorKind,
    verifying,
    search,
    refresh,
    reload,
    loadMore,
    select,
    refreshDocument,
    retryContent,
    cancel
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useArtifactsStore, import.meta.hot))
}
