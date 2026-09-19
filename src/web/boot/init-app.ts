import { defineBoot } from '#q-app'
import { useRepositoryStore } from '@/stores/repository-store'
import { useAppInfoStore } from '@/stores/app-info-store'

export default defineBoot(() => {
  const repositoryStore = useRepositoryStore()
  void repositoryStore.fetchInfo()

  const appInfoStore = useAppInfoStore()
  void appInfoStore.fetchInfo()
})
