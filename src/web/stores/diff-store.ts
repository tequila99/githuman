import { ref, computed } from 'vue'
import { defineStore, acceptHMRUpdate } from 'pinia'
import { apiGet } from '@/api/client'
import { decodeGitPath } from '@/utils/git-path'
import type { DiffFile } from '@/api/types'

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
  const error = ref<string | null>(null)

  const changedPaths = computed(() =>
    [...stagedFiles.value, ...unstagedFiles.value].map(
      file => file.newPath || file.oldPath
    )
  )

  async function fetchDiff() {
    loading.value = true
    error.value = null

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
    } catch (err) {
      stagedFiles.value = []
      unstagedFiles.value = []
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  return { stagedFiles, unstagedFiles, loading, error, changedPaths, fetchDiff }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useDiffStore, import.meta.hot))
}
