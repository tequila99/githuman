import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { usePreviewStore } from '@/stores/windows/preview-store'
import { useWindowStore } from '@/stores/windows/window-store'
import { useAgentStore } from '@/stores/agent-store'
import { createChatState } from '@/utils/agent-chat'
import { setStorageBackend } from '@/utils/safe-storage'
import { previewFingerprint, findDiagram } from '@/utils/windows/preview-source'

const originalFetch = globalThis.fetch
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  globalThis.fetch = originalFetch
  setStorageBackend(null)
})
test('file previews deduplicate by source, retain state and close only their own window', () => {
  const store = usePreviewStore()
  const source = { type: 'file', path: 'a.md', ref: 'WORKTREE' } as const
  const id = store.open('markdown', source, 'a')
  store.tabs[0]!.scroll.y = 300
  useWindowStore().ensure('preview').minimized = true
  assert.equal(store.open('markdown', source, 'a'), id)
  assert.equal(store.tabs[0]?.scroll.y, 300)
  assert.equal(useWindowStore().ensure('preview').minimized, false)
  store.open('markdown', { ...source, ref: 'INDEX' }, 'staged a')
  assert.equal(store.tabs.length, 2)
  useWindowStore().focus('terminal')
  store.closeAll()
  assert.equal(useWindowStore().ensure('preview').open, false)
  assert.equal(useWindowStore().ensure('terminal').open, true)
})
test('reload restores locators and view state without persisting document data', () => {
  const saved = new Map<string, string>()
  setStorageBackend({
    getItem: key => saved.get(key),
    setItem: (key, value) => saved.set(key, value),
    removeItem: key => saved.delete(key)
  })
  const store = usePreviewStore()
  store.open(
    'diagram',
    { type: 'file', path: 'a.md', ref: 'WORKTREE' },
    'a · 1',
    0,
    'private diagram text'
  )
  store.tabs[0]!.scale = 2
  store.remember()
  assert.ok(!saved.get('githuman:preview:v1')?.includes('private diagram text'))
  setActivePinia(createPinia())
  const restored = usePreviewStore()
  assert.equal(restored.tabs[0]?.scale, 2)
  assert.equal(restored.activeId, restored.tabs[0]?.id)
  assert.equal(Object.keys(restored.data).length, 0)
})
test('missing files retain a tab and can recover; inactive tabs do not load', async () => {
  let missing = true
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return missing
      ? new Response('{}', { status: 404 })
      : new Response(JSON.stringify({ content: '# Returned', isBinary: false }))
  }
  const store = usePreviewStore()
  const id = store.open(
    'markdown',
    { type: 'file', path: 'a.md', ref: 'WORKTREE' },
    'a'
  )
  assert.equal(calls, 0)
  await store.load(id)
  assert.equal(store.runtime(id).missing, 'file')
  assert.equal(store.tabs.length, 1)
  missing = false
  await store.load(id)
  assert.equal(store.runtime(id).missing, null)
  assert.equal(store.runtime(id).text, '# Returned')
})
test('closing a tab during a request cannot bring back its runtime data', async () => {
  let answer: ((response: Response) => void) | undefined
  globalThis.fetch = () =>
    new Promise(resolve => {
      answer = resolve
    })
  const store = usePreviewStore()
  const id = store.open(
    'markdown',
    { type: 'file', path: 'a.md', ref: 'WORKTREE' },
    'a'
  )
  const request = store.load(id)
  store.close(id)
  assert.ok(answer)
  answer(new Response(JSON.stringify({ content: 'late', isBinary: false })))
  await request
  assert.equal(store.data[id], undefined)
})
test('diagram locators prefer unchanged content then fall back to the previous position', () => {
  const fingerprint = previewFingerprint('old')
  assert.equal(findDiagram(['new', 'old'], 0, fingerprint), 1)
  assert.equal(findDiagram(['edited'], 0, fingerprint), 0)
  assert.equal(findDiagram([], 0, fingerprint), -1)
})
test('message diagrams resolve without a mounted chat and keep missing sources', async () => {
  const agent = useAgentStore()
  const chat = createChatState()
  chat.items.push({
    kind: 'agent',
    id: 'ev:12',
    text: '```mermaid\ngraph TD; A-->B\n```'
  })
  agent.chats.session = {
    info: {
      id: 'session',
      presetId: 'test',
      name: 'Test',
      status: 'ready',
      reviewId: null,
      autoApprove: false,
      error: null
    },
    chat,
    pendingContext: [],
    error: null,
    reviewStale: false,
    closing: false,
    seq: 1
  }
  const store = usePreviewStore()
  const id = store.open(
    'diagram',
    { type: 'message', sessionId: 'session', messageId: 'ev:12' },
    'chat · 1',
    0,
    'graph TD; A-->B\n'
  )
  await store.load(id)
  assert.equal(store.runtime(id).text.trim(), 'graph TD; A-->B')
  delete agent.chats.session
  await store.load(id)
  assert.equal(store.runtime(id).missing, 'message')
  assert.equal(store.tabs.length, 1)
})

test('opening an edited or moved diagram reuses its original tab', () => {
  const store = usePreviewStore()
  const source = { type: 'file', path: 'a.md', ref: 'WORKTREE' } as const
  const old = 'graph TD; A-->B\n'
  const fresh = 'graph TD; A-->C\n'
  const id = store.open('diagram', source, 'a · 1', 0, old)
  const text = `\`\`\`mermaid\ngraph TD; X-->Y\n\`\`\`\n\`\`\`mermaid\n${old}\`\`\``
  assert.equal(store.open('diagram', source, 'a · 2', 1, old, text), id)
  assert.equal(store.tabs[0]?.index, 1)
  assert.equal(store.open('diagram', source, 'a · 2', 1, fresh), id)
  assert.equal(store.tabs.length, 1)
})

test('local files open active tabs without uploading or persisting their contents', async () => {
  const saved = new Map<string, string>()
  setStorageBackend({
    getItem: key => saved.get(key),
    setItem: (key, value) => saved.set(key, value),
    removeItem: key => saved.delete(key)
  })
  globalThis.fetch = () => {
    throw new Error('Local previews must not fetch from the server')
  }
  const store = usePreviewStore()
  const id = store.openLocal(new File(['# Local document'], 'local.md'))!
  assert.equal(store.activeId, id)
  await store.load(id)
  assert.equal(store.runtime(id).text, '# Local document')
  const imageId = store.openLocal(
    new File(['image'], 'image.png', { type: 'image/png' })
  )!
  assert.equal(store.activeId, imageId)
  assert.equal(store.tabs.length, 2)
  await store.load(imageId)
  const url = store.runtime(imageId).image
  assert.match(url, /^blob:/)
  assert.equal((await fetchOriginalBlob(url)).size, 5)
  store.close(imageId)
  await assert.rejects(fetchOriginalBlob(url))
  const preferences = saved.get('githuman:preview:v1')!
  assert.deepEqual(JSON.parse(preferences).tabs, [])
  assert.ok(!preferences.includes('Local document'))
  setActivePinia(createPinia())
  assert.equal(usePreviewStore().tabs.length, 0)
})
async function fetchOriginalBlob(url: string) {
  return (await originalFetch(url)).blob()
}
test('local PDF retains its File without a URL and unsupported files do not create tabs', async () => {
  const store = usePreviewStore()
  assert.equal(store.openLocal(new File(['binary'], 'program.exe')), null)
  assert.equal(store.tabs.length, 0)
  const id = store.openLocal(
    new File(['%PDF-1.7'], 'document.pdf', { type: 'application/pdf' })
  )!
  await store.load(id)
  assert.equal(store.activeTab?.kind, 'pdf')
  assert.equal(store.runtime(id).pdf?.name, 'document.pdf')
  store.closeAll()
  assert.equal(store.data[id], undefined)
})

test('local diagrams retain their file after the Markdown tab closes', async () => {
  const store = usePreviewStore()
  const id = store.openLocal(
    new File(['```mermaid\ngraph TD\nA-->B\n```'], 'diagram.md')
  )!
  await store.load(id)
  const source = store.activeTab!.source
  const diagramId = store.open(
    'diagram',
    source,
    'diagram.md · diagram · 1',
    0,
    'graph TD\nA-->B\n'
  )
  store.close(id)
  await store.load(diagramId)
  assert.equal(store.runtime(diagramId).missing, null)
  assert.equal(store.runtime(diagramId).text, 'graph TD\nA-->B\n')
  store.close(diagramId)
  assert.equal(store.tabs.length, 0)
})
