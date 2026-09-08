import { defineBoot } from '#q-app'
import { useRepositoryStore } from '@/stores/repository-store'

export default defineBoot(({ store }) => {
  const repositoryStore = useRepositoryStore(store)
  void repositoryStore.fetchInfo()
})
