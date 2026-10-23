import { watch, onScopeDispose } from 'vue'
import { useRouter, type LocationQueryRaw, type Router } from 'vue-router'
import {
  useWorkspaceNavigation,
  enqueueWorkspaceNavigation,
  type WorkspaceNavigation
} from './use-workspace-navigation'
import { useAgentStore } from '@/stores/agent-store'
import { useFileExplorerStore } from '@/stores/file-explorer-store'
import { useWindowStore } from '@/stores/windows/window-store'
import { useTerminalStore } from '@/stores/terminal-store'
import { useAppInfoStore } from '@/stores/app-info-store'
import { usePreviewStore } from '@/stores/windows/preview-store'

interface CoordinatorStores {
  agent: ReturnType<typeof useAgentStore>
  explorer: ReturnType<typeof useFileExplorerStore>
  windows: ReturnType<typeof useWindowStore>
  terminal: ReturnType<typeof useTerminalStore>
  preview: ReturnType<typeof usePreviewStore>
  appInfo: ReturnType<typeof useAppInfoStore>
}

/** Turns store actions into workspace navigation. Tests give the router and the stores. */
export function createWorkspaceCoordinator(
  workspace: WorkspaceNavigation,
  router: Router,
  stores: CoordinatorStores
) {
  const { agent, explorer, windows, terminal, preview, appInfo } = stores
  // A getter, not `useRoute()`: the coordinator also runs without a component.
  const current = () => router.currentRoute.value
  watch(
    [
      () => current().fullPath,
      () => agent.initialized,
      () => appInfo.initialized,
      () => agent.enabled,
      () => terminal.enabled,
      workspace.narrow
    ],
    () => {
      if (
        !workspace.narrow.value ||
        !agent.initialized ||
        !appInfo.initialized
      ) {
        return
      }
      void enqueueWorkspaceNavigation(
        router,
        () => ({
          query: workspace.projection.value.query,
          hash: current().hash
        }),
        true
      )
    },
    { immediate: true }
  )
  watch(workspace.narrow, narrow => {
    if (!narrow) return
    const active = windows.activeId
    const pane =
      agent.enabled && agent.panelOpen
        ? 'agent'
        : (explorer.selectedPath && current().path === '/') ||
            current().name === 'note-document' ||
            typeof current().query.folder === 'string'
          ? 'content'
          : 'list'
    void enqueueWorkspaceNavigation(
      router,
      () => {
        const query: LocationQueryRaw = {
          ...current().query,
          uiPane: pane
        }
        delete query.uiWindow
        if (
          active === 'preview' ||
          (active === 'terminal' && terminal.enabled)
        ) {
          query.uiWindow = active
        }
        return { query, hash: current().hash }
      },
      true
    )
  })
  onScopeDispose(
    explorer.$onAction(({ name, after }) => {
      if (name === 'selectFile') {
        const previous = explorer.scrollRequest
        after(() => {
          if (explorer.browseMode || explorer.scrollRequest !== previous) {
            void workspace.selectPane('content')
          }
        })
      }
    })
  )
  onScopeDispose(
    agent.$onAction(({ name, args, after }) => {
      if (
        !workspace.narrow.value ||
        !['openChat', 'createChat', 'addContext'].includes(name)
      ) {
        return
      }
      const desktopOpen = agent.panelOpen
      after(result => {
        if (!workspace.narrow.value) return
        agent.panelOpen = desktopOpen
        if (
          (name === 'addContext' && result === 'added') ||
          (name === 'createChat' && typeof result === 'string') ||
          (name === 'openChat' &&
            typeof args[0] === 'string' &&
            agent.chats[args[0]])
        ) {
          void workspace.selectPane('agent')
        }
      })
    })
  )
  onScopeDispose(
    preview.$onAction(({ name, after }) => {
      if (['show', 'open', 'openLocal', 'activate'].includes(name)) {
        after(result => {
          if (name === 'openLocal' && result === null) return
          void workspace.openWindow('preview')
        })
      }
    })
  )
  onScopeDispose(
    terminal.$onAction(({ name, after }) => {
      if (name === 'show' || name === 'create') {
        const wasCreating = terminal.creating
        after(() => {
          if (
            terminal.enabled &&
            (name === 'show' || (!wasCreating && terminal.creating))
          ) {
            void workspace.openWindow('terminal')
          }
        })
      }
    })
  )
  onScopeDispose(
    windows.$onAction(({ name, args, after }) => {
      if (name === 'close') {
        after(() => {
          if (!workspace.narrow.value || workspace.window.value !== args[0]) {
            return
          }
          void enqueueWorkspaceNavigation(
            router,
            () => {
              const query = { ...current().query }
              delete query.uiWindow
              return { query, hash: current().hash }
            },
            true
          )
        })
      }
    })
  )
  return workspace
}

export function useWorkspaceCoordinator() {
  return createWorkspaceCoordinator(useWorkspaceNavigation(), useRouter(), {
    agent: useAgentStore(),
    explorer: useFileExplorerStore(),
    windows: useWindowStore(),
    terminal: useTerminalStore(),
    preview: usePreviewStore(),
    appInfo: useAppInfoStore()
  })
}
