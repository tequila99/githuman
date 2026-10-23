import { computed } from 'vue'
import { useQuasar } from 'quasar'
import { useRouter, type Router, type RouteLocationRaw } from 'vue-router'
import { useAgentStore } from '@/stores/agent-store'
import { useTerminalStore } from '@/stores/terminal-store'
import {
  isNarrowWorkspace,
  paneQuery,
  workspaceProjection,
  type WorkspacePane,
  type WorkspaceWindow
} from '@/utils/workspace-navigation'

// Serial navigation deduplicates nested successful actions before the router commits.
const PENDING = new WeakMap<Router, Promise<unknown>>()

export function enqueueWorkspaceNavigation(
  router: Router,
  target: () => RouteLocationRaw,
  replace = false
) {
  const previous = PENDING.get(router) ?? Promise.resolve()
  async function navigate() {
    await previous.catch(() => {})
    const next = target()
    if (router.resolve(next).fullPath === router.currentRoute.value.fullPath) {
      return
    }
    return router[replace ? 'replace' : 'push'](next)
  }
  const operation = navigate()
  PENDING.set(router, operation)
  return operation
}

/** The workspace state without component context: tests give the router and the flags. */
export function createWorkspaceNavigation(options: {
  router: Router
  narrow: () => boolean
  agentEnabled: () => boolean
  terminalEnabled: () => boolean
}) {
  const { router } = options
  const narrow = computed(options.narrow)
  const projection = computed(() =>
    workspaceProjection(
      router.currentRoute.value,
      options.agentEnabled(),
      options.terminalEnabled()
    )
  )
  const pane = computed(() => projection.value.pane)
  const window = computed(() => (narrow.value ? projection.value.window : null))
  function selectPane(value: WorkspacePane) {
    if (!narrow.value || !projection.value.panes.includes(value)) {
      return Promise.resolve()
    }
    return enqueueWorkspaceNavigation(router, () => ({
      query: paneQuery(router.currentRoute.value.query, value),
      hash: router.currentRoute.value.hash
    }))
  }
  function openWindow(value: WorkspaceWindow) {
    if (!narrow.value) return Promise.resolve()
    return enqueueWorkspaceNavigation(router, () => ({
      query: {
        ...router.currentRoute.value.query,
        uiPane: projection.value.pane,
        uiWindow: value
      },
      hash: router.currentRoute.value.hash
    }))
  }
  function back() {
    if (typeof router.options.history.state.back === 'string') {
      router.back()
    } else {
      void enqueueWorkspaceNavigation(
        router,
        () => ({
          query: paneQuery(
            router.currentRoute.value.query,
            window.value ? pane.value : 'list'
          ),
          hash: router.currentRoute.value.hash
        }),
        true
      )
    }
  }
  return { narrow, pane, window, projection, selectPane, openWindow, back }
}

export type WorkspaceNavigation = ReturnType<typeof createWorkspaceNavigation>

export function useWorkspaceNavigation(): WorkspaceNavigation {
  const $q = useQuasar()
  const agent = useAgentStore()
  const terminal = useTerminalStore()
  return createWorkspaceNavigation({
    router: useRouter(),
    narrow: () => isNarrowWorkspace($q.screen.width),
    agentEnabled: () => agent.enabled,
    terminalEnabled: () => terminal.enabled
  })
}
