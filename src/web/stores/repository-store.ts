import { defineStore, acceptHMRUpdate } from 'pinia'
import { apiGet } from '@/api/client'
import type { RepositoryInfo } from '@/api/types'

export interface RepositoryState {
  info: RepositoryInfo | null
  loading: boolean
  error: string | null
}

export const useRepositoryStore = defineStore('repository', {
  state: (): RepositoryState => ({
    info: null,
    loading: false,
    error: null
  }),

  actions: {
    async fetchInfo() {
      this.loading = true
      this.error = null

      try {
        this.info = await apiGet<RepositoryInfo>('/api/git/info')
      } catch (error) {
        this.info = null
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.loading = false
      }
    }
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useRepositoryStore, import.meta.hot))
}
