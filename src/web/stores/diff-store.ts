import { ref, computed, shallowRef } from 'vue'
import { defineStore, acceptHMRUpdate } from 'pinia'
import { apiGet } from '@/api/client'
import { decodeGitPath } from '@/utils/git-path'
import { singleFlight } from '@/utils/single-flight'
import type { DiffFile, DiffFileSummary } from '@/api/types'
import { pathOf } from '@/utils/diff-file'
import { cardStateKey, type DiffSource } from '@/utils/card-state-key'
import { errorMessage } from '@/utils/error-message'

function decodeDiffFile<T extends { oldPath: string; newPath: string }>(
  file: T
): T {
  return {
    ...file,
    oldPath: decodeGitPath(file.oldPath),
    newPath: decodeGitPath(file.newPath)
  }
}

/** A list entry: the summary without its signature, and with empty hunks. Hunks load on demand. */
function toListFile(summary: DiffFileSummary): DiffFile {
  const { signature: _signature, ...file } = summary
  return { ...file, hunks: [] }
}

/**
 * Reuses a file's previous object when its signature has not changed since
 * the last fetch (ADR 0033). The loaded hunks and the token cache are keyed by
 * the object's identity: a new object for an unchanged file would load and
 * tokenize it again on every SSE refetch. Replaces the earlier comparison of
 * whole files through `JSON.stringify` (ADR 0014).
 */
function reconcileFiles(
  previous: DiffFile[],
  previousSignatures: Map<string, string>,
  next: DiffFileSummary[]
): { files: DiffFile[]; signatures: Map<string, string> } {
  const previousByPath = new Map(previous.map(file => [pathOf(file), file]))
  const signatures = new Map<string, string>()
  const files = next.map(summary => {
    const path = pathOf(summary)
    signatures.set(path, summary.signature)
    const previousFile = previousByPath.get(path)
    return previousFile && previousSignatures.get(path) === summary.signature
      ? previousFile
      : toListFile(summary)
  })
  return { files, signatures }
}

export type { DiffSource }

export const useDiffStore = defineStore('diff', () => {
  const stagedFiles = ref<DiffFile[]>([])
  const unstagedFiles = ref<DiffFile[]>([])
  // Signatures of the lists above, by path. Plain maps: they are not shown anywhere.
  let stagedSignatures = new Map<string, string>()
  let unstagedSignatures = new Map<string, string>()
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  /**
   * Only the very first fetch should block the UI with a spinner. Later
   * refetches (stage/unstage/discard, SSE) keep the current list mounted —
   * swapping it for a spinner collapses the scroll area and resets its
   * scroll position to the top (#26).
   */
  const initialLoading = computed(() => loading.value && !loaded.value)

  const changedPaths = computed(() =>
    [...stagedFiles.value, ...unstagedFiles.value].map(
      file => file.newPath || file.oldPath
    )
  )

  /**
   * Hunks of files that were opened, by `source:path`. `for` is the list entry the hunks were
   * read for: when the list holds another object, the hunks are stale. They stay on screen
   * until the new ones arrive, so an open card does not blink on every SSE update.
   */
  const hunkEntries = shallowRef(
    new Map<string, { file: DiffFile; for: DiffFile }>()
  )
  // An error belongs to the list entry it was read for: a new entry gets a new attempt.
  const hunkErrors = shallowRef(
    new Map<string, { message: string; for: DiffFile }>()
  )
  const hunksInFlight = new Map<string, DiffFile>()

  function listFor(source: DiffSource): DiffFile[] {
    return source === 'staged' ? stagedFiles.value : unstagedFiles.value
  }

  /** The hunks loaded for `file`, possibly stale; undefined before the first load. */
  function hunksOf(source: DiffSource, file: DiffFile): DiffFile | undefined {
    return hunkEntries.value.get(cardStateKey(source, pathOf(file)))?.file
  }

  /** True when the hunks match the current list entry. */
  function hunksFresh(source: DiffSource, file: DiffFile): boolean {
    return (
      hunkEntries.value.get(cardStateKey(source, pathOf(file)))?.for === file
    )
  }

  /** The error of the last hunks request for this list entry, if it failed. */
  function hunksError(source: DiffSource, file: DiffFile): string | undefined {
    const entry = hunkErrors.value.get(cardStateKey(source, pathOf(file)))
    return entry?.for === file ? entry.message : undefined
  }

  /** Forgets the error, so that the card can ask for the hunks again. */
  function clearHunksError(source: DiffSource, file: DiffFile) {
    const key = cardStateKey(source, pathOf(file))
    if (!hunkErrors.value.has(key)) return
    const next = new Map(hunkErrors.value)
    next.delete(key)
    hunkErrors.value = next
  }

  function retryHunks(source: DiffSource, file: DiffFile) {
    clearHunksError(source, file)
    return ensureHunks(source, file)
  }

  /** Loads the hunks of `file` unless they are fresh or already on the way. */
  async function ensureHunks(source: DiffSource, file: DiffFile) {
    const key = cardStateKey(source, pathOf(file))
    if (hunksFresh(source, file) || hunksInFlight.get(key) === file) return
    hunksInFlight.set(key, file)
    const query = new URLSearchParams({
      path: file.newPath,
      oldPath: file.oldPath,
      status: file.status
    })
    try {
      const detail = decodeDiffFile(
        await apiGet<DiffFile>(`/api/diff/${source}/file?${query}`)
      )
      // The list may have moved on while the request ran: drop an answer for a gone entry.
      if (!listFor(source).includes(file)) return
      hunkEntries.value = new Map(hunkEntries.value).set(key, {
        file: detail,
        for: file
      })
      clearHunksError(source, file)
    } catch (err) {
      if (!listFor(source).includes(file)) return
      hunkErrors.value = new Map(hunkErrors.value).set(key, {
        message: errorMessage(err),
        for: file
      })
    } finally {
      if (hunksInFlight.get(key) === file) hunksInFlight.delete(key)
    }
  }

  /** Forgets the hunks and errors of files that left a list. */
  function pruneHunks() {
    const alive = new Set([
      ...stagedFiles.value.map(file => cardStateKey('staged', pathOf(file))),
      ...unstagedFiles.value.map(file => cardStateKey('unstaged', pathOf(file)))
    ])
    const keptHunks = new Map(
      [...hunkEntries.value].filter(([key]) => alive.has(key))
    )
    if (keptHunks.size !== hunkEntries.value.size) hunkEntries.value = keptHunks
    const keptErrors = new Map(
      [...hunkErrors.value].filter(([key]) => alive.has(key))
    )
    if (keptErrors.size !== hunkErrors.value.size) hunkErrors.value = keptErrors
  }

  /** Parallel responses could land out of order (#28); see singleFlight (#37). */
  const fetchDiff = singleFlight(doFetchDiff)

  async function doFetchDiff() {
    loading.value = true

    try {
      const [staged, unstaged] = await Promise.all([
        apiGet<DiffFileSummary[]>('/api/diff/staged/files'),
        apiGet<DiffFileSummary[]>('/api/diff/unstaged/files')
      ])
      const nextStaged = reconcileFiles(
        stagedFiles.value,
        stagedSignatures,
        staged.map(decodeDiffFile)
      )
      const nextUnstaged = reconcileFiles(
        unstagedFiles.value,
        unstagedSignatures,
        unstaged.map(decodeDiffFile)
      )
      stagedFiles.value = nextStaged.files
      stagedSignatures = nextStaged.signatures
      unstagedFiles.value = nextUnstaged.files
      unstagedSignatures = nextUnstaged.signatures
      pruneHunks()
      // Cleared only on success: resetting at the start would blink the
      // error banner away during every retry and SSE refetch (#35).
      error.value = null
    } catch (err) {
      // A failed refetch keeps the last good lists: clearing them would
      // unmount the file list and reset its scroll position (#26).
      if (!loaded.value) {
        stagedFiles.value = []
        unstagedFiles.value = []
        stagedSignatures = new Map()
        unstagedSignatures = new Map()
      }
      error.value = errorMessage(err)
    } finally {
      loading.value = false
      loaded.value = true
    }
  }

  return {
    stagedFiles,
    unstagedFiles,
    loading,
    loaded,
    initialLoading,
    error,
    changedPaths,
    hunksOf,
    hunksFresh,
    hunksError,
    clearHunksError,
    ensureHunks,
    retryHunks,
    fetchDiff
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useDiffStore, import.meta.hot))
}
