import { ref } from 'vue'
import { defineStore, acceptHMRUpdate } from 'pinia'
import { apiGet } from '@/api/client'
import type { RepositoryInfo } from '@/api/types'
import { errorMessage } from '@/utils/error-message'
import { singleFlight } from '@/utils/single-flight'

export const useRepositoryStore = defineStore('repository', () => {
  const info = ref<RepositoryInfo | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetchInfo = singleFlight(async () => {
    loading.value = true
    error.value = null

    try {
      info.value = await apiGet<RepositoryInfo>('/api/git/info')
    } catch (err) {
      info.value = null
      error.value = errorMessage(err)
    } finally {
      loading.value = false
    }
  })

  return { info, loading, error, fetchInfo }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useRepositoryStore, import.meta.hot))
}
