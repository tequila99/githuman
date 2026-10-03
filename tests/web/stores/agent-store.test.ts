import { test, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { setActivePinia, createPinia } from 'pinia'
import { useAgentStore } from '@/stores/agent-store'
import { MAX_AGENT_SESSIONS } from '@/api/types'
import { setStorageBackend } from '@/utils/safe-storage'
import type {
  AgentChatEvent,
  AgentSessionInfo,
  AgentSessionState,
  AgentStreamEnvelope
} from '@/api/types'

/** A setting as the agent publishes it (see the `state` tests). */
const MODEL_OPTION = {
  id: 'model',
  name: 'Model',
  type: 'select' as const,
  currentValue: 'm1',
  options: [{ value: 'm1', name: 'Model 1' }]
}

class FakeEventSource {
  static instances: FakeEventSource[] = []
  static readonly CLOSED = 2
  readyState = 1
  closed = false
  listeners = new Map<string, ((event: unknown) => void)[]>()
  url: string
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, fn: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  close() {
    this.closed = true
    this.readyState = FakeEventSource.CLOSED
  }
  frame(type: string, data: unknown = {}) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) })
    this.listeners.get(type)?.forEach(fn => fn(event))
  }
  emit(sessionId: string, id: number, event: AgentChatEvent) {
    const envelope: AgentStreamEnvelope = { sessionId, id, event }
    this.frame('agent', envelope)
  }
  fail() {
    this.readyState = FakeEventSource.CLOSED
    this.listeners.get('error')?.forEach(fn => fn({}))
  }
}

/** The page's agent stream (the other EventSource is the app-wide one). */
const agentStream = () =>
  FakeEventSource.instances.filter(es => es.url === '/api/agent/events').at(-1)!

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

let originalFetch: typeof fetch
let requests: { url: string; method: string; body: unknown }[]
let routes: Record<string, () => Response>
let storage: Map<string, string>

const blockedStorage = () => {
  throw new Error('storage is blocked')
}
let pinia: ReturnType<typeof createPinia>

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  originalFetch = globalThis.fetch
  FakeEventSource.instances = []
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
  storage = new Map()
  setStorageBackend({
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k)
  })
  requests = []
  routes = {}
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const method = init?.method ?? 'GET'
    requests.push({
      url,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    })
    const handler = routes[`${method} ${url}`]
    return handler ? handler() : json({ message: 'not found' }, 404)
  }
})

afterEach(() => {
  // Stops the streams and pending reconnects of every store the test made.
  // eslint-disable-next-line no-underscore-dangle -- Pinia keeps no public list of its stores
  pinia._s.forEach(store => store.$dispose())
  globalThis.fetch = originalFetch
  setStorageBackend(null)
  mock.timers.reset()
})

const presets = [
  {
    id: 'claude',
    title: 'Claude Code',
    available: false,
    autoApprovesEdits: false
  },
  { id: 'pi', title: 'pi', available: true, autoApprovesEdits: true }
]

function session(id: string, over: Partial<AgentSessionInfo> = {}) {
  const info: AgentSessionInfo = {
    id,
    presetId: 'pi',
    name: `Chat ${id}`,
    status: 'ready',
    reviewId: null,
    autoApprove: false,
    error: null,
    ...over
  }
  return info
}

/** The chat's state, asserting it exists. */
function chatState(store: ReturnType<typeof useAgentStore>, id: string) {
  const entry = store.chats[id]
  assert.ok(entry, `chat ${id} exists`)
  return entry.chat
}

/** An initialised store whose server lists `sessions`. */
async function storeWith(...sessions: AgentSessionInfo[]) {
  routes['GET /api/agent/presets'] = () => json(presets)
  routes['GET /api/agent/sessions'] = () => json(sessions)
  const store = useAgentStore()
  await store.init()
  return store
}

test('init: agents off (404) → disabled, no error, no stream', async () => {
  const store = useAgentStore()
  await store.init()
  assert.equal(store.enabled, false)
  assert.equal(store.error, null)
  assert.equal(
    FakeEventSource.instances.some(es => es.url === '/api/agent/events'),
    false
  )
})

test('init: registers every running chat, activates the remembered one, and opens one stream for all of them', async () => {
  storage.set('githuman.agent.activeChat', 's2')
  const store = await storeWith(session('s1'), session('s2'), session('s3'))

  assert.deepEqual(store.order, ['s1', 's2', 's3'])
  assert.equal(store.activeId, 's2')
  assert.equal(
    FakeEventSource.instances.filter(es => es.url === '/api/agent/events')
      .length,
    1
  )
})

test('init: without a remembered chat the first one is active; no chats → none', async () => {
  const store = await storeWith(session('s1'), session('s2'))
  assert.equal(store.activeId, 's1')

  setActivePinia(createPinia())
  setStorageBackend({
    getItem: blockedStorage,
    setItem: blockedStorage,
    removeItem: blockedStorage
  })
  const empty = await storeWith()
  assert.equal(empty.activeId, null)
  assert.equal(empty.activeChat, null)
})

test('events are routed to their chat; each transcript is built apart', async () => {
  const store = await storeWith(session('s1'), session('s2'))
  const es = agentStream()
  es.emit('s1', 1, { type: 'user', text: 'one', context: [] })
  es.emit('s2', 2, { type: 'user', text: 'two', context: [] })
  es.emit('s1', 3, { type: 'message', role: 'agent', text: 'yo' })

  assert.deepEqual(
    store.chats.s1?.chat.items.map(i => i.kind),
    ['user', 'agent']
  )
  assert.deepEqual(
    store.chats.s2?.chat.items.map(i => i.kind),
    ['user']
  )
})

test('chats keep updating while the panel is closed', async () => {
  const store = await storeWith(session('s1'))
  assert.equal(store.panelOpen, false)
  agentStream().emit('s1', 1, { type: 'status', status: 'busy' })
  agentStream().emit('s1', 2, { type: 'message', role: 'agent', text: 'x' })
  assert.equal(store.chats.s1?.chat.status, 'busy')
  assert.equal(store.chats.s1?.chat.items.length, 1)
})

test('replays after a reconnect do not duplicate anything', async () => {
  const store = await storeWith(session('s1'))
  const es = agentStream()
  es.emit('s1', 5, { type: 'message', role: 'agent', text: 'a' })
  es.emit('s1', 5, { type: 'message', role: 'agent', text: 'a' })
  es.emit('s1', 4, { type: 'message', role: 'agent', text: 'old' })
  assert.deepEqual(
    store.chats.s1?.chat.items.map(i => ('text' in i ? i.text : '')),
    ['a']
  )
})

test('a gap frame makes the chat start over', async () => {
  const store = await storeWith(session('s1'))
  const es = agentStream()
  es.emit('s1', 1, { type: 'message', role: 'agent', text: 'a' })
  es.frame('gap', { sessionId: 's1' })
  assert.equal(store.chats.s1?.chat.items.length, 0)
  es.emit('s1', 1, { type: 'message', role: 'agent', text: 'a' })
  assert.equal(store.chats.s1?.chat.items.length, 1)
})

function stateOf(
  sessionId: string,
  over: Partial<AgentSessionState> = {}
): AgentSessionState {
  return {
    sessionId,
    status: 'ready',
    autoApprove: false,
    config: [MODEL_OPTION],
    permissions: [],
    ...over
  }
}

test('after a gap the state frame brings back auto-approve, settings and open requests', async () => {
  const store = await storeWith(session('s1'))
  const es = agentStream()
  es.emit('s1', 1, { type: 'auto-approve', enabled: true })
  assert.equal(store.chats.s1?.chat.autoApprove, true)

  // The buffer lost that event: the gap resets the chat, the state restores it.
  es.frame('gap', { sessionId: 's1' })
  assert.equal(store.chats.s1?.chat.autoApprove, false)
  es.frame(
    'state',
    stateOf('s1', {
      autoApprove: true,
      permissions: [
        {
          type: 'permission',
          requestId: 'r1',
          toolCallId: 't1',
          title: 'Run it',
          options: [],
          diffs: []
        }
      ]
    })
  )
  const chat = store.chats.s1?.chat
  assert.equal(chat?.autoApprove, true)
  assert.equal(chat?.status, 'ready')
  assert.deepEqual(chat?.config, [MODEL_OPTION])
  assert.deepEqual(
    chat?.permissions.map(p => p.requestId),
    ['r1']
  )

  // The replay repeats the request: it must not be listed twice.
  es.emit('s1', 7, {
    type: 'permission',
    requestId: 'r1',
    toolCallId: 't1',
    title: 'Run it',
    options: [],
    diffs: []
  })
  assert.equal(chat?.permissions.length, 1)
})

test('the state of a chat the page has not registered yet is applied when it is', async () => {
  const store = await storeWith()
  agentStream().frame('state', stateOf('late', { autoApprove: true }))
  routes['GET /api/agent/sessions'] = () => json([session('late')])
  await store.refreshSessions()

  assert.equal(store.chats.late?.chat.autoApprove, true)
  assert.deepEqual(store.chats.late?.chat.config, [MODEL_OPTION])
})

test('the state of a chat that is gone is dropped', async () => {
  const store = await storeWith()
  agentStream().frame('state', stateOf('ghost'))
  routes['GET /api/agent/sessions'] = () => json([])
  await store.refreshSessions()
  routes['GET /api/agent/sessions'] = () => json([session('ghost')])
  await store.refreshSessions()

  assert.equal(store.chats.ghost?.chat.config.length, 0)
})

test('events of a session not known yet wait for it, and trigger a look at the server list', async () => {
  const store = await storeWith()
  const listCalls = () =>
    requests.filter(r => r.url === '/api/agent/sessions').length
  const before = listCalls()

  routes['GET /api/agent/sessions'] = () => json([session('late')])
  agentStream().emit('late', 1, {
    type: 'message',
    role: 'agent',
    text: 'hello'
  })
  await store.refreshSessions()

  assert.ok(listCalls() > before)
  assert.equal(store.chats.late?.chat.items.length, 1)
})

test('a "sessions" frame brings in chats opened elsewhere and drops closed ones', async () => {
  const store = await storeWith(session('s1'), session('s2'))
  routes['GET /api/agent/sessions'] = () => json([session('s2'), session('s3')])
  agentStream().frame('sessions')
  await store.refreshSessions()
  assert.deepEqual(store.order, ['s2', 's3'])
  assert.equal(
    store.activeId,
    's2',
    'the active chat went away: a neighbour takes over'
  )
})

test('a session list fetched before a chat was created does not remove it', async () => {
  const store = await storeWith(session('s1'))
  routes['GET /api/agent/sessions'] = () => json([session('s1')])
  routes['POST /api/agent/sessions'] = () => json(session('s9'), 201)
  // Holds the list request back until the chat has been created.
  const hold = Promise.withResolvers<void>()
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const isList =
      (init?.method ?? 'GET') === 'GET' &&
      typeof input === 'string' &&
      input.includes('/sessions')
    if (isList) await hold.promise
    return realFetch(input, init)
  }

  const refreshing = store.refreshSessions()
  await store.createChat('pi', 'new')
  hold.resolve()
  await refreshing
  assert.ok(store.order.includes('s9'))
})

test('createChat posts preset and name, activates the chat, opens the panel and carries the context over', async () => {
  routes['POST /api/agent/sessions'] = () =>
    json(session('s7', { name: 'Fix it', status: 'starting' }), 201)
  const store = await storeWith()
  const id = await store.createChat('pi', 'Fix it', [
    { kind: 'file', path: 'a.ts' }
  ])

  assert.equal(id, 's7')
  assert.deepEqual(requests.at(-1)?.body, { presetId: 'pi', name: 'Fix it' })
  assert.equal(store.activeId, 's7')
  assert.equal(store.panelOpen, true)
  assert.deepEqual(store.chats.s7?.pendingContext, [
    { kind: 'file', path: 'a.ts' }
  ])
  assert.equal(store.chats.s7?.chat.status, 'starting')
  assert.equal(storage.get('githuman.agent.activeChat'), 's7')
})

test('createChat surfaces the server’s refusal and creates nothing', async () => {
  routes['POST /api/agent/sessions'] = () =>
    json({ message: 'At most 5 chats can be open at once' }, 409)
  const store = await storeWith()
  await assert.rejects(store.createChat('pi', 'x'))
  assert.match(store.error ?? '', /At most 5/)
  assert.equal(store.order.length, 0)
})

test('closeChat deletes the session, removes the chat and activates a neighbour', async () => {
  routes['DELETE /api/agent/sessions/s2'] = () => json(null, 204)
  const store = await storeWith(session('s1'), session('s2'), session('s3'))
  store.selectChat('s2')
  await store.closeChat('s2')

  assert.deepEqual(store.order, ['s1', 's3'])
  assert.equal(store.activeId, 's3')
  assert.equal(requests.at(-1)?.method, 'DELETE')
  await store.closeChat('s3')
  assert.equal(
    store.activeId,
    's1',
    'the last chat falls back to the one before'
  )
})

test('a closed chat stays closed even if a stale session list still names it', async () => {
  routes['DELETE /api/agent/sessions/s1'] = () => json(null, 204)
  const store = await storeWith(session('s1'), session('s2'))
  await store.closeChat('s1')
  await store.refreshSessions() // the server list still has s1 in this test
  assert.deepEqual(store.order, ['s2'])
  agentStream().emit('s1', 9, { type: 'status', status: 'busy' })
  assert.equal(store.chats.s1, undefined)
})

test('closing a chat the server no longer knows is not an error', async () => {
  const store = await storeWith(session('s1'))
  await store.closeChat('s1') // DELETE answers 404 here
  assert.equal(store.order.length, 0)
})

test('a failed DELETE keeps the chat, shows the error and allows a second try', async () => {
  const store = await storeWith(session('s1'))
  routes['DELETE /api/agent/sessions/s1'] = () =>
    json({ message: 'server error' }, 500)
  await assert.rejects(store.closeChat('s1'))
  assert.deepEqual(store.order, ['s1'])
  assert.equal(store.chats.s1?.error, 'server error')
  assert.equal(store.chats.s1?.closing, false)

  // The chat still shows what the server sends, and refresh keeps it.
  agentStream().emit('s1', 3, { type: 'message', role: 'agent', text: 'x' })
  await store.refreshSessions()
  assert.equal(store.chats.s1?.chat.items.length, 1)

  routes['DELETE /api/agent/sessions/s1'] = () => json(null, 204)
  await store.closeChat('s1')
  assert.deepEqual(store.order, [])
})

test('context added while a message is on its way stays for the next one', async () => {
  const store = await storeWith(session('s1'))
  store.addContext({ kind: 'file', path: 'a.ts' })
  routes['POST /api/agent/sessions/s1/prompt'] = () => {
    store.addContext({ kind: 'file', path: 'late.ts' })
    return json(null, 204)
  }
  await store.send('go')
  assert.deepEqual(store.chats.s1?.pendingContext, [
    { kind: 'file', path: 'late.ts' }
  ])
})

test('the number of chats is capped: canAddChat turns off and the dialog will not open', async () => {
  const many = Array.from({ length: MAX_AGENT_SESSIONS }, (_, i) =>
    session(`s${i}`)
  )
  const store = await storeWith(...many)
  assert.equal(store.canAddChat, false)
  assert.equal(store.openNewChatDialog(), false)
  assert.equal(store.newChatDialog.open, false)
  store.selectChat(null)
  assert.equal(store.addContext({ kind: 'file', path: 'a.ts' }), 'limit')
})

test('send posts text with the pending context and clears it; it stays on failure', async () => {
  routes['POST /api/agent/sessions/s1/prompt'] = () => json(null, 204)
  const store = await storeWith(session('s1'))
  assert.equal(store.addContext({ kind: 'file', path: 'a.ts' }), 'added')
  store.addContext({ kind: 'file', path: 'a.ts' }) // duplicate ignored
  assert.equal(store.chats.s1?.pendingContext.length, 1)
  assert.equal(store.panelOpen, true)

  await store.send('  do it  ', [
    { kind: 'file', path: 'a.ts' }, // mentioned too: still sent once
    { kind: 'file', path: 'b.ts' }
  ])
  assert.deepEqual(requests.at(-1)?.body, {
    text: 'do it',
    context: [
      { kind: 'file', path: 'a.ts' },
      { kind: 'file', path: 'b.ts' }
    ]
  })
  assert.equal(store.chats.s1?.pendingContext.length, 0)

  store.addContext({ kind: 'review', reviewId: 'r' })
  routes['POST /api/agent/sessions/s1/prompt'] = () =>
    json({ message: 'busy' }, 409)
  await assert.rejects(store.send('again'))
  assert.equal(store.chats.s1?.error, 'busy')
  assert.equal(store.chats.s1?.pendingContext.length, 1)
})

test('send is a no-op while the agent is not ready, or the text is blank', async () => {
  const store = await storeWith(session('s1'))
  const chat = chatState(store, 's1')
  chat.status = 'busy'
  assert.equal(await store.send('x'), false)
  chat.status = 'starting'
  assert.equal(await store.send('x'), false)
  chat.status = 'ready'
  assert.equal(await store.send('   '), false)
  assert.equal(requests.filter(r => r.method === 'POST').length, 0)
})

test('actions address the chat they are given, not just the active one', async () => {
  routes['POST /api/agent/sessions/s2/prompt'] = () => json(null, 204)
  const store = await storeWith(session('s1'), session('s2'))
  assert.equal(store.activeId, 's1')
  await store.send('to two', [], 's2')
  assert.equal(requests.at(-1)?.url, '/api/agent/sessions/s2/prompt')
})

test('addContext with no chat opens the new-chat dialog holding the context', async () => {
  const store = await storeWith()
  assert.equal(store.addContext({ kind: 'file', path: 'a.ts' }), 'dialog')
  assert.equal(store.newChatDialog.open, true)
  assert.deepEqual(store.newChatDialog.context, [
    { kind: 'file', path: 'a.ts' }
  ])
  store.closeNewChatDialog()
  assert.deepEqual(store.newChatDialog, { open: false, context: [] })
})

test('answerPermission posts the chosen option; cancelling sends an empty answer', async () => {
  routes['POST /api/agent/sessions/s1/permissions/r1'] = () => json(null, 204)
  const store = await storeWith(session('s1'))
  await store.answerPermission('r1', 'allow')
  await store.answerPermission('r1')
  assert.deepEqual(
    requests.filter(r => r.method === 'POST').map(r => r.body),
    [{ optionId: 'allow' }, {}]
  )
})

test('setAutoApprove posts the switch; the new state comes back through the stream', async () => {
  routes['POST /api/agent/sessions/s1/auto-approve'] = () => json(null, 204)
  const store = await storeWith(session('s1'))
  await store.setAutoApprove(true)
  assert.deepEqual(requests.at(-1)?.body, { enabled: true })
  assert.equal(store.chats.s1?.chat.autoApprove, false, 'not assumed')
  agentStream().emit('s1', 1, { type: 'auto-approve', enabled: true })
  assert.equal(store.chats.s1?.chat.autoApprove, true)
})

test('setConfig posts the change; it is skipped unless ready and surfaces errors', async () => {
  routes['POST /api/agent/sessions/s1/config'] = () => json(null, 204)
  const store = await storeWith(session('s1'))
  await store.setConfig('model', 'm2')
  await store.setConfig('fast', true)
  assert.deepEqual(
    requests.filter(r => r.method === 'POST').map(r => r.body),
    [
      { configId: 'model', value: 'm2' },
      { configId: 'fast', value: true }
    ]
  )

  chatState(store, 's1').status = 'busy'
  await store.setConfig('model', 'm3')
  assert.equal(requests.filter(r => r.method === 'POST').length, 2)

  chatState(store, 's1').status = 'ready'
  routes['POST /api/agent/sessions/s1/config'] = () =>
    json({ message: 'agent refused' }, 502)
  await assert.rejects(store.setConfig('model', 'm3'))
  assert.equal(store.chats.s1?.error, 'agent refused')
})

test('a worktree change flags only the chats a review was sent to', async () => {
  const store = await storeWith(session('s1'), session('s2'))
  store.markWorktreeChanged()
  assert.equal(store.chats.s1?.reviewStale, false)

  chatState(store, 's1').items.push({
    kind: 'user',
    id: '1',
    text: 'x',
    context: [{ kind: 'review', reviewId: 'r' }]
  })
  store.markWorktreeChanged()
  assert.equal(store.chats.s1?.reviewStale, true)
  assert.equal(store.chats.s2?.reviewStale, false)
})

test('a stream the browser gave up on is reopened after a pause', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  await storeWith(session('s1'))
  const first = agentStream()
  first.fail()
  assert.equal(
    FakeEventSource.instances.filter(es => es.url === '/api/agent/events')
      .length,
    1
  )
  mock.timers.tick(2000)
  assert.notEqual(agentStream(), first)
})

const agentStreams = () =>
  FakeEventSource.instances.filter(es => es.url === '/api/agent/events')

test('init during a reconnect pause connects at once and cancels the wait', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const store = await storeWith(session('s1'))
  agentStream().fail()
  assert.equal(agentStreams().length, 1)

  await store.init()
  assert.equal(agentStreams().length, 2)
  mock.timers.tick(2000)
  assert.equal(agentStreams().length, 2)
})

test('dispose closes the stream and cancels a pending reconnect', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const store = await storeWith(session('s1'))
  const first = agentStream()
  first.fail()
  store.$dispose()
  mock.timers.tick(2000)
  assert.equal(agentStreams().length, 1)

  setActivePinia(createPinia())
  const live = await storeWith(session('s1'))
  const open = agentStream()
  live.$dispose()
  assert.equal(open.closed, true)
})

test('dispose while init waits for the agents does not open a stream', async () => {
  const gate = Promise.withResolvers<void>()
  const answering = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    await gate.promise
    return answering(input, init)
  }
  routes['GET /api/agent/presets'] = () => json(presets)
  routes['GET /api/agent/sessions'] = () => json([])
  const store = useAgentStore()
  const started = store.init()
  store.$dispose()
  gate.resolve()
  await started
  assert.equal(agentStreams().length, 0)
})

test('a stream that fails after dispose does not arm a reconnect', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const store = await storeWith(session('s1'))
  const stale = agentStream()
  store.$dispose()
  stale.fail()
  mock.timers.tick(2000)
  assert.equal(agentStreams().length, 1)
})

test('repeated failures reopen the stream once each, never several at a time', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  await storeWith(session('s1'))
  for (let round = 1; round <= 3; round++) {
    const current = agentStream()
    current.fail()
    current.fail() // a stale second error from the same stream is ignored
    mock.timers.tick(2000)
    assert.equal(agentStreams().length, round + 1)
  }
})

test('a second error from a replaced stream does not drop the current one', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const store = await storeWith(session('s1'))
  const old = agentStream()
  old.fail()
  await store.init() // connects at once: a new stream is now the current one
  assert.equal(agentStreams().length, 2)

  old.fail() // late, from the stream that was replaced
  mock.timers.tick(2000)
  assert.equal(agentStreams().length, 2)
})

test('addContext keeps explicit uploads in their original chat and deduplicates them', async () => {
  const store = await storeWith(session('s1'), session('s2'))
  store.selectChat('s2')
  const attachment = {
    kind: 'attachment' as const,
    name: 'note.txt',
    mimeType: 'text/plain',
    data: 'aGk='
  }
  assert.equal(store.addContext(attachment, 's1'), 'added')
  store.addContext(attachment, 's1')
  assert.deepEqual(store.chats.s1?.pendingContext, [attachment])
  assert.deepEqual(store.chats.s2?.pendingContext, [])
  assert.equal(store.activeId, 's2')
})

test('addContext discards a delayed upload to a removed chat without opening a dialog', async () => {
  const store = await storeWith()
  assert.equal(
    store.addContext({ kind: 'file', path: 'a.ts' }, 'removed'),
    'missing'
  )
  assert.equal(store.newChatDialog.open, false)
})
