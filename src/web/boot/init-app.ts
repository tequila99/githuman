import { defineBoot } from '#q-app'
import { useRepositoryStore } from '@/stores/repository-store'
import { useAppInfoStore } from '@/stores/app-info-store'
import { useAgentStore } from '@/stores/agent-store'
import { useAccessStore } from '@/stores/access-store'
import { useDevicesStore } from '@/stores/devices-store'
import { onServerHello } from '@/composables/use-server-events'
import { detectServerRestart } from '@/utils/detect-server-restart'
import { onAccessProblem } from '@/utils/access-problem'
import { accessRedirect } from '@/utils/access-redirect'
import { singleFlight } from '@/utils/single-flight'
import { warmCodeFonts } from '@/utils/warm-fonts'

export default defineBoot(async ({ router }) => {
  // The access decides what this tab starts (ADR 0079, item 11).
  const access = useAccessStore()
  await access.check()
  router.beforeEach(to => accessRedirect(access.mode, to))
  if (access.mode !== 'app') return

  warmCodeFonts()

  const repositoryStore = useRepositoryStore()
  void repositoryStore.fetchInfo()

  const appInfoStore = useAppInfoStore()
  void appInfoStore.fetchInfo()

  void useAgentStore().init()

  if (access.isLocal) useDevicesStore().start()

  // A reload stops every stream, socket and timer of the app at once, and
  // the next boot shows the pairing page.
  const recheck = singleFlight(async () => {
    const status = await access.check()
    if (status === 'none' || status === 'pending') window.location.reload()
  })
  onAccessProblem(() => void recheck())

  // A restarted server may be a newer version (new frontend build, old
  // lazy chunks gone) or serve another repository on the same port — a full
  // reload is the only reliable way to pick that up.
  onServerHello(detectServerRestart(() => window.location.reload()))
})
