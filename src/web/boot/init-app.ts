import { defineBoot } from '#q-app'
import { useRepositoryStore } from '@/stores/repository-store'
import { useAppInfoStore } from '@/stores/app-info-store'
import { onServerHello } from '@/composables/use-server-events'
import { detectServerRestart } from '@/composables/reload-on-server-restart'

export default defineBoot(() => {
  const repositoryStore = useRepositoryStore()
  void repositoryStore.fetchInfo()

  const appInfoStore = useAppInfoStore()
  void appInfoStore.fetchInfo()

  // A restarted server may be a newer version (new frontend build, old
  // lazy chunks gone) or serve another repository on the same port — a full
  // reload is the only reliable way to pick that up.
  onServerHello(detectServerRestart(() => window.location.reload()))
})
