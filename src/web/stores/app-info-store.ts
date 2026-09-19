import { ref } from 'vue'
import { defineStore, acceptHMRUpdate } from 'pinia'
import { apiGet } from '@/api/client'
import type { AppInfo } from '@/api/types'

export const useAppInfoStore = defineStore('appInfo', () => {
  const version = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchInfo() {
    loading.value = true
    error.value = null

    try {
      const info = await apiGet<AppInfo>('/api/app-info')
      version.value = info.version
    } catch (err) {
      version.value = null
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  return { version, loading, error, fetchInfo }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAppInfoStore, import.meta.hot))
}
