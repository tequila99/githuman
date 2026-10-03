import { ref, computed } from 'vue'
import { defineStore, acceptHMRUpdate } from 'pinia'
import { apiGet } from '@/api/client'
import { decodeGitPath } from '@/utils/git-path'
import { singleFlight } from '@/utils/single-flight'
import type { DiffFile } from '@/api/types'
import { errorMessage } from '@/utils/error-message'

function decodeDiffFile(file: DiffFile): DiffFile {
  return {
    ...file,
    oldPath: decodeGitPath(file.oldPath),
    newPath: decodeGitPath(file.newPath)
  }
}

/**
 * Reuses a file's previous object reference when its content hasn't
 * actually changed since the last fetch. Components key per-file UI state
 * (e.g. `DiffFileCard`'s "show full file" toggle) and re-highlighting off
 * `props.file`'s identity — without this, every poll/SSE-triggered refetch
 * would hand every open card a brand-new object and silently reset that
 * state, even for files nothing happened to.
 */
function reconcileFiles(previous: DiffFile[], next: DiffFile[]): DiffFile[] {
  const previousByPath = new Map(
    previous.map(file => [file.newPath || file.oldPath, file])
  )

  return next.map(file => {
    const previousFile = previousByPath.get(file.newPath || file.oldPath)
    if (previousFile && JSON.stringify(previousFile) === JSON.stringify(file)) {
      return previousFile
    }
    return file
  })
}

export type DiffSource = 'staged' | 'unstaged'

export const useDiffStore = defineStore('diff', () => {
  const stagedFiles = ref<DiffFile[]>([])
  const unstagedFiles = ref<DiffFile[]>([])
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

  /** Parallel responses could land out of order (#28); see singleFlight (#37). */
  const fetchDiff = singleFlight(doFetchDiff)

  async function doFetchDiff() {
    loading.value = true

    try {
      const [staged, unstaged] = await Promise.all([
        apiGet<DiffFile[]>('/api/diff/staged'),
        apiGet<DiffFile[]>('/api/diff/unstaged')
      ])
      stagedFiles.value = reconcileFiles(
        stagedFiles.value,
        staged.map(decodeDiffFile)
      )
      unstagedFiles.value = reconcileFiles(
        unstagedFiles.value,
        unstaged.map(decodeDiffFile)
      )
      // Cleared only on success: resetting at the start would blink the
      // error banner away during every retry and SSE refetch (#35).
      error.value = null
    } catch (err) {
      // A failed refetch keeps the last good lists: clearing them would
      // unmount the file list and reset its scroll position (#26).
      if (!loaded.value) {
        stagedFiles.value = []
        unstagedFiles.value = []
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
    initialLoading,
    error,
    changedPaths,
    fetchDiff
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useDiffStore, import.meta.hot))
}
