import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, shallowRef } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createWorkspaceNavigation } from '@/composables/use-workspace-navigation'
import { createWorkspaceCoordinator } from '@/composables/use-workspace-coordinator'
import { useAgentStore } from '@/stores/agent-store'
import { useAppInfoStore } from '@/stores/app-info-store'
import { useFileExplorerStore } from '@/stores/file-explorer-store'
import { useTerminalStore } from '@/stores/terminal-store'
import { usePreviewStore } from '@/stores/windows/preview-store'
import { useWindowStore } from '@/stores/windows/window-store'
import { setStorageBackend } from '@/utils/safe-storage'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  setStorageBackend(null)
})

// Router navigation and the workspace queue settle after several microtasks.
async function settle() {
  for (let i = 0; i < 5; i++) {
    await nextTick()
    await new Promise(resolve => setImmediate(resolve))
  }
}

async function setup(path = '/', narrowAtStart = true) {
  setStorageBackend({
    getItem: () => undefined,
    setItem: () => {},
    removeItem: () => {}
  })
  setActivePinia(createPinia())
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: {} },
      {
        path: '/notes/:storageId/:id',
        name: 'note-document',
        component: {}
      }
    ]
  })
  await router.push(path)
  const narrow = shallowRef(narrowAtStart)
  const stores = {
    agent: useAgentStore(),
    explorer: useFileExplorerStore(),
    windows: useWindowStore(),
    terminal: useTerminalStore(),
    preview: usePreviewStore(),
    appInfo: useAppInfoStore()
  }
  // The coordinator waits for both stores before it normalizes the URL.
  stores.agent.initialized = true
  stores.appInfo.initialized = true
  const scope = effectScope()
  const workspace = scope.run(() => {
    const navigation = createWorkspaceNavigation({
      router,
      narrow: () => narrow.value,
      agentEnabled: () => stores.agent.enabled,
      terminalEnabled: () => stores.terminal.enabled
    })
    createWorkspaceCoordinator(navigation, router, stores)
    return navigation
  })!
  cleanups.push(() => scope.stop())
  await settle()
  const query = () => router.currentRoute.value.query
  return { router, narrow, stores, workspace, query }
}

test('narrow mode normalizes an unknown pane and keeps unrelated query', async () => {
  const s = await setup('/?uiPane=bogus&filter=x')
  assert.deepEqual(s.query(), { uiPane: 'list', filter: 'x' })
  assert.equal(s.workspace.pane.value, 'list')
})

test('desktop to narrow keeps the active window, then the agent, then the list', async () => {
  const s = await setup('/', false)
  s.stores.windows.focus('preview')
  s.narrow.value = true
  await settle()
  assert.equal(s.query().uiWindow, 'preview')
  assert.equal(s.workspace.window.value, 'preview')

  const agent = await setup('/', false)
  agent.stores.agent.enabled = true
  agent.stores.agent.panelOpen = true
  agent.narrow.value = true
  await settle()
  assert.equal(agent.query().uiPane, 'agent')
  assert.equal(agent.query().uiWindow, undefined)
  // The narrow layout does not change the desktop preference.
  assert.equal(agent.stores.agent.panelOpen, true)
})

test('a file selected in browse mode opens the content pane', async () => {
  const s = await setup('/?uiPane=list')
  s.stores.explorer.browseMode = true
  s.stores.explorer.selectFile('a.ts')
  await settle()
  assert.equal(s.query().uiPane, 'content')
})

test('closing the shown window removes it from the URL and keeps the pane', async () => {
  const s = await setup('/?uiPane=content')
  s.stores.terminal.enabled = true
  await s.workspace.openWindow('terminal')
  await settle()
  assert.equal(s.query().uiWindow, 'terminal')
  s.stores.windows.close('terminal')
  await settle()
  assert.equal(s.query().uiWindow, undefined)
  assert.equal(s.query().uiPane, 'content')
})

test('a missing chat, a missing context target and a failed chat do not switch panes', async () => {
  const s = await setup('/?uiPane=list')
  s.stores.agent.enabled = true
  await settle()
  s.stores.agent.openChat('missing')
  assert.equal(
    s.stores.agent.addContext({ kind: 'file', path: 'a.ts' }, 'missing'),
    'missing'
  )
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => Promise.reject(new Error('offline'))
  try {
    await assert.rejects(s.stores.agent.createChat('preset', 'chat'))
  } finally {
    globalThis.fetch = originalFetch
  }
  await settle()
  assert.equal(s.query().uiPane, 'list')
  assert.equal(s.stores.agent.panelOpen, false)
})
