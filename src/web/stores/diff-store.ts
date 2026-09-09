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

export interface DiffState {
  stagedFiles: DiffFile[]
  unstagedFiles: DiffFile[]
  loading: boolean
  error: string | null
}

export const useDiffStore = defineStore('diff', {
  state: (): DiffState => ({
    stagedFiles: [],
    unstagedFiles: [],
    loading: false,
    error: null
  }),

  getters: {
    changedPaths(state): string[] {
      return [...state.stagedFiles, ...state.unstagedFiles].map(
        file => file.newPath || file.oldPath
      )
    }
  },

  actions: {
    async fetchDiff() {
      this.loading = true
      this.error = null

      try {
        const [staged, unstaged] = await Promise.all([
          apiGet<DiffFile[]>('/api/diff/staged'),
          apiGet<DiffFile[]>('/api/diff/unstaged')
        ])
        this.stagedFiles = reconcileFiles(
          this.stagedFiles,
          staged.map(decodeDiffFile)
        )
        this.unstagedFiles = reconcileFiles(
          this.unstagedFiles,
          unstaged.map(decodeDiffFile)
        )
      } catch (error) {
        this.stagedFiles = []
        this.unstagedFiles = []
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.loading = false
      }
    }
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useDiffStore, import.meta.hot))
}
