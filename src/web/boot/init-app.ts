import { defineBoot } from '#q-app'
import { useRepositoryStore } from '@/stores/repository-store'

export default defineBoot(() => {
  const repositoryStore = useRepositoryStore()
  void repositoryStore.fetchInfo()
})
