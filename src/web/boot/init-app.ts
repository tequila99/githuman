import { defineBoot } from '#q-app'
import { useRepositoryStore } from '@/stores/repository-store'
import { useAppInfoStore } from '@/stores/app-info-store'
import { useAgentStore } from '@/stores/agent-store'
import { onServerHello } from '@/composables/use-server-events'
import { detectServerRestart } from '@/utils/detect-server-restart'
import { warmCodeFonts } from '@/utils/warm-fonts'

export default defineBoot(() => {
  warmCodeFonts()

  const repositoryStore = useRepositoryStore()
  void repositoryStore.fetchInfo()

  const appInfoStore = useAppInfoStore()
  void appInfoStore.fetchInfo()

  void useAgentStore().init()

  // A restarted server may be a newer version (new frontend build, old
  // lazy chunks gone) or serve another repository on the same port — a full
  // reload is the only reliable way to pick that up.
  onServerHello(detectServerRestart(() => window.location.reload()))
})
