import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createTempGitRepo } from '../helpers/git-fixture.ts'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { buildApp } from '../../../src/server/app.ts'
import type { AgentPreset } from '../../../src/shared/agents/types.ts'
import { MAX_AGENT_SESSIONS } from '../../../src/shared/agents/constants.ts'
import {
  type AgentChatEnvelope,
  type AgentSessionInfo,
  type AgentSessionState,
  type AgentStreamEnvelope
} from '../../../src/shared/agents/types.ts'

// Over Fastify's default 1 MB body limit on purpose.
const PNG = Buffer.alloc(2 * 1024 * 1024, 7).toString('base64')

const FAKE_AGENT = join(import.meta.dirname, '../fixtures/fake-acp-agent.ts')

function fakePreset(
  id = 'fake',
  env: Record<string, string> = {}
): AgentPreset {
  return {
    id,
    title: 'Fake',
    command: process.execPath,
    args: [FAKE_AGENT],
    autoApprovesEdits: false,
    env
  }
}

async function setup(t: TestContext, presets: AgentPreset[] = [fakePreset()]) {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const db = createTestDatabase()
  const app = buildApp({
    repositoryPath: fixture.dir,
    db,
    agentPresets: presets
  })
  t.after(async () => {
    await app.close()
  })
  const address = await app.listen({ port: 0, host: '127.0.0.1' })

  async function post(path: string, body?: unknown) {
    return fetch(new URL(path, address), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {})
    })
  }

  async function sessionInfo(id: string): Promise<AgentSessionInfo> {
    const res = await fetch(new URL(`/api/agent/sessions/${id}`, address))
    return (await res.json()) as AgentSessionInfo
  }

  /** Creates a session and waits until its agent finished starting (or failed to). */
  async function createSession(presetId = 'fake', name?: string) {
    const res = await post('/api/agent/sessions', {
      presetId,
      ...(name === undefined ? {} : { name })
    })
    assert.equal(res.status, 201)
    const { id } = (await res.json()) as AgentSessionInfo
    const deadline = Date.now() + 10_000
    while ((await sessionInfo(id)).status === 'starting') {
      assert.ok(Date.now() < deadline, 'session did not leave "starting"')
      await sleep(20)
    }
    return id
  }

  return { app, address, fixture, post, createSession, sessionInfo, db }
}

const stopped = (list: AgentChatEnvelope[]) =>
  list.some(e => e.event.type === 'stop')

/**
 * Reads the shared agent stream into `events` (only `sessionId`'s; everything
 * else lands in `all`/`other`); `waitFor` resolves once a predicate matches.
 */
function openEvents(
  t: TestContext,
  address: string,
  sessionId: string | null,
  lastEventId?: number
) {
  const controller = new AbortController()
  t.after(() => controller.abort())
  const events: AgentChatEnvelope[] = []
  const all: AgentStreamEnvelope[] = []
  const frames: { event: string; data: unknown }[] = []
  const waiters: (() => void)[] = []

  void (async () => {
    const res = await fetch(new URL('/api/agent/events', address), {
      signal: controller.signal,
      headers: {
        accept: 'text/event-stream',
        ...(lastEventId === undefined
          ? {}
          : { 'last-event-id': String(lastEventId) })
      }
    })
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) {
        return
      }
      buffer += decoder.decode(value, { stream: true })
      let index: number
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const lines = frame.split('\n')
        const data = lines.find(line => line.startsWith('data:'))
        const name = lines.find(line => line.startsWith('event:'))
        if (data) {
          const parsed: unknown = JSON.parse(data.slice(5))
          const event = name ? name.slice(6).trim() : 'message'
          frames.push({ event, data: parsed })
          if (event === 'agent') {
            const envelope = parsed as AgentStreamEnvelope
            all.push(envelope)
            if (sessionId === null || envelope.sessionId === sessionId) {
              events.push({ id: envelope.id, event: envelope.event })
            }
          }
          waiters.splice(0).forEach(wake => wake())
        }
      }
    }
  })().catch(() => {})

  async function waitFor(
    predicate: (events: AgentChatEnvelope[]) => boolean,
    timeoutMs = 10_000
  ) {
    const deadline = Date.now() + timeoutMs
    while (!predicate(events)) {
      const left = deadline - Date.now()
      assert.ok(
        left > 0,
        `timed out; events so far: ${JSON.stringify(events.map(e => e.event))}`
      )
      await new Promise<void>(resolve => {
        waiters.push(resolve)
        setTimeout(resolve, Math.min(left, 200))
      })
    }
    return events
  }

  const text = () =>
    events
      .map(e => e.event)
      .filter(e => e.type === 'message' && e.role === 'agent')
      .map(e => (e.type === 'message' ? e.text : ''))
      .join('')

  return { events, all, frames, waitFor, text, stopped }
}

test('agent routes are not registered unless agent presets are passed', async t => {
  const app = buildApp({})
  t.after(async () => {
    await app.close()
  })
  const response = await app.inject({
    method: 'GET',
    url: '/api/agent/presets'
  })
  assert.equal(response.statusCode, 404)
})

test('a rejected request never reaches the route handler (no agent is spawned)', async t => {
  const { app } = await setup(t)

  const rejected = await app.inject({
    method: 'POST',
    url: '/api/agent/sessions',
    headers: { host: 'localhost:3847', origin: 'https://evil.example' },
    payload: { presetId: 'fake' }
  })
  assert.equal(rejected.statusCode, 403)

  // Had the handler run after the 403, a session (and agent process) would exist.
  await new Promise(resolve => setTimeout(resolve, 300))
  const sessions = await app.inject({
    method: 'GET',
    url: '/api/agent/sessions'
  })
  assert.deepEqual(sessions.json(), [])
})

test('requests with a foreign Origin or a non-loopback Host are rejected', async t => {
  const { app } = await setup(t)

  const foreignOrigin = await app.inject({
    method: 'GET',
    url: '/api/agent/presets',
    headers: { host: 'localhost:3847', origin: 'https://evil.example' }
  })
  assert.equal(foreignOrigin.statusCode, 403)

  const rebinding = await app.inject({
    method: 'GET',
    url: '/api/agent/presets',
    headers: { host: 'evil.example:3847', origin: 'http://evil.example:3847' }
  })
  assert.equal(rebinding.statusCode, 403)

  const ok = await app.inject({
    method: 'GET',
    url: '/api/agent/presets',
    headers: { host: 'localhost:3847', origin: 'http://localhost:3847' }
  })
  assert.equal(ok.statusCode, 200)
})

test('presets list reports availability and the auto-approve flag', async t => {
  const { app } = await setup(t, [
    fakePreset(),
    { ...fakePreset('missing'), command: 'definitely-not-installed-xyz' }
  ])
  const presets = (
    await app.inject({ method: 'GET', url: '/api/agent/presets' })
  ).json()
  assert.deepEqual(
    presets.map((p: { id: string; available: boolean }) => [p.id, p.available]),
    [
      ['fake', true],
      ['missing', false]
    ]
  )
})

test('unknown preset → 404; a command that cannot start leaves a closed session carrying the reason', async t => {
  const { address, post, createSession, sessionInfo } = await setup(t, [
    { ...fakePreset('broken'), command: 'definitely-not-installed-xyz' }
  ])
  assert.equal(
    (await post('/api/agent/sessions', { presetId: 'nope' })).status,
    404
  )

  const stream = openEvents(t, address, null)
  const id = await createSession('broken')
  const info = await sessionInfo(id)
  assert.equal(info.status, 'closed')
  assert.match(info.error ?? '', /Cannot start/)

  await stream.waitFor(events => events.some(e => e.event.type === 'error'))
  const closed = stream.events.find(
    e => e.event.type === 'status' && e.event.status === 'closed'
  )
  assert.ok(closed, 'a closed status event is published')
})

test('a session is created at once, still starting, under the name it was given', async t => {
  const { post, sessionInfo, createSession } = await setup(t)
  const res = await post('/api/agent/sessions', {
    presetId: 'fake',
    name: '  Refactor  '
  })
  assert.equal(res.status, 201)
  const created = (await res.json()) as AgentSessionInfo
  assert.equal(created.status, 'starting')
  assert.equal(created.name, 'Refactor')
  assert.equal(created.autoApprove, false)

  const unnamed = await createSession()
  assert.equal(
    (await sessionInfo(unnamed)).name,
    'Fake',
    'defaults to the agent title'
  )
  assert.equal(
    (
      await post('/api/agent/sessions', {
        presetId: 'fake',
        name: 'x'.repeat(61)
      })
    ).status,
    400
  )
})

test('full turn: prompt streams a reply and ends with stop, status goes busy → ready', async t => {
  const { address, post, createSession } = await setup(t)
  const id = await createSession()
  const stream = openEvents(t, address, id)

  assert.equal(
    (await post(`/api/agent/sessions/${id}/prompt`, { text: 'hello' })).status,
    202
  )
  await stream.waitFor(
    events => stream.stopped(events) && events.at(-1)?.event.type === 'status'
  )

  assert.equal(stream.text(), 'echo:hello')
  const statuses = stream.events.flatMap(e =>
    e.event.type === 'status' ? [e.event.status] : []
  )
  assert.deepEqual(statuses, ['ready', 'busy', 'ready'])
  const user = stream.events.find(e => e.event.type === 'user')?.event
  assert.deepEqual(user, { type: 'user', text: 'hello', context: [] })
  assert.deepEqual(
    stream.events.map(e => e.id),
    stream.events.map((_, i) => i + 1)
  )
})

test('a prompt to a busy session is refused before any context is built', async t => {
  const { address, post, createSession } = await setup(t)
  const id = await createSession()
  const stream = openEvents(t, address, id)
  await post(`/api/agent/sessions/${id}/prompt`, { text: 'slow' })
  await stream.waitFor(events => events.some(e => e.event.type === 'message'))

  // The context item is invalid; a busy session answers 409 first, not 400.
  const res = await post(`/api/agent/sessions/${id}/prompt`, {
    text: 'again',
    context: [{ kind: 'file', path: '../outside' }]
  })
  assert.equal(res.status, 409)

  await post(`/api/agent/sessions/${id}/cancel`)
  await stream.waitFor(events => events.some(e => e.event.type === 'stop'))
})

test('a second prompt while one is running → 409', async t => {
  const { address, post, createSession } = await setup(t)
  const id = await createSession()
  const stream = openEvents(t, address, id)

  await post(`/api/agent/sessions/${id}/prompt`, { text: 'slow' })
  await stream.waitFor(events => events.some(e => e.event.type === 'message'))
  assert.equal(
    (await post(`/api/agent/sessions/${id}/prompt`, { text: 'again' })).status,
    409
  )

  await post(`/api/agent/sessions/${id}/cancel`)
  await stream.waitFor(events => events.some(e => e.event.type === 'stop'))
})

test('cancel ends the turn with stopReason "cancelled"', async t => {
  const { address, post, createSession } = await setup(t)
  const id = await createSession()
  const stream = openEvents(t, address, id)

  await post(`/api/agent/sessions/${id}/prompt`, { text: 'slow' })
  await stream.waitFor(events => events.some(e => e.event.type === 'message'))
  assert.equal((await post(`/api/agent/sessions/${id}/cancel`)).status, 204)
  await stream.waitFor(stream.stopped)

  const stop = stream.events.find(e => e.event.type === 'stop')?.event
  assert.deepEqual(stop, { type: 'stop', stopReason: 'cancelled' })
})

test('permission request blocks the tool call until answered: allow completes it', async t => {
  const { address, post, createSession } = await setup(t)
  const id = await createSession()
  const stream = openEvents(t, address, id)

  await post(`/api/agent/sessions/${id}/prompt`, { text: 'edit' })
  await stream.waitFor(events =>
    events.some(e => e.event.type === 'permission')
  )

  const request = stream.events.find(e => e.event.type === 'permission')!.event
  assert.ok(request.type === 'permission')
  assert.deepEqual(request.diffs, [
    { path: '/repo/a.txt', oldText: null, newText: 'hi' }
  ])
  assert.ok(
    !stream.stopped(stream.events),
    'turn must not finish before the answer'
  )

  const answer = await post(
    `/api/agent/sessions/${id}/permissions/${request.requestId}`,
    {
      optionId: 'allow'
    }
  )
  assert.equal(answer.status, 204)
  await stream.waitFor(stream.stopped)

  assert.equal(stream.text(), 'edited')
  assert.ok(stream.events.some(e => e.event.type === 'permission-resolved'))
  const done = stream.events.filter(e => e.event.type === 'tool').at(-1)!.event
  assert.ok(done.type === 'tool' && done.status === 'completed')
  // A request can be answered only once.
  assert.equal(
    (
      await post(`/api/agent/sessions/${id}/permissions/${request.requestId}`, {
        optionId: 'allow'
      })
    ).status,
    404
  )
})

test('permission reject fails the tool call; cancelling the request counts as a rejection', async t => {
  const { address, post, createSession } = await setup(t)
  const id = await createSession()
  const stream = openEvents(t, address, id)

  await post(`/api/agent/sessions/${id}/prompt`, { text: 'edit' })
  await stream.waitFor(events =>
    events.some(e => e.event.type === 'permission')
  )
  const request = stream.events.find(e => e.event.type === 'permission')!.event
  assert.ok(request.type === 'permission')
  // No optionId = cancel
  await post(`/api/agent/sessions/${id}/permissions/${request.requestId}`, {})
  await stream.waitFor(stream.stopped)

  assert.equal(stream.text(), 'blocked')
  const done = stream.events.filter(e => e.event.type === 'tool').at(-1)!.event
  assert.ok(done.type === 'tool' && done.status === 'failed')
})

test('the agent dying mid-turn closes the session, rejects pending work and refuses new prompts', async t => {
  const { address, post, createSession, sessionInfo } = await setup(t)
  const id = await createSession()
  const stream = openEvents(t, address, id)

  await post(`/api/agent/sessions/${id}/prompt`, { text: 'crash' })
  await stream.waitFor(events =>
    events.some(e => e.event.type === 'status' && e.event.status === 'closed')
  )
  const again = await post(`/api/agent/sessions/${id}/prompt`, {
    text: 'hello'
  })
  assert.equal(again.status, 409)
  assert.match(((await again.json()) as { message: string }).message, /closed/)

  // The reason is kept: once in the error event, once on the session itself.
  const errors = stream.events.filter(e => e.event.type === 'error')
  assert.equal(errors.length, 1)
  assert.match(JSON.stringify(errors[0]?.event), /code 3/)
  assert.match((await sessionInfo(id)).error ?? '', /code 3/)
})

test('closing a session on purpose is no failure: no error event', async t => {
  const { address, post, createSession } = await setup(t)
  const id = await createSession()
  const stream = openEvents(t, address, id)
  await post(`/api/agent/sessions/${id}/prompt`, { text: 'slow' })
  await stream.waitFor(events => events.some(e => e.event.type === 'message'))

  const res = await fetch(new URL(`/api/agent/sessions/${id}`, address), {
    method: 'DELETE'
  })
  assert.equal(res.status, 204)
  await sleep(700)

  assert.equal(
    stream.events.some(e => e.event.type === 'error'),
    false
  )
})

test('a setting the agent adds on its own can be changed afterwards', async t => {
  const { address, post, createSession } = await setup(t)
  const id = await createSession()
  const stream = openEvents(t, address, id)
  const url = `/api/agent/sessions/${id}/config`

  assert.equal(
    (await post(url, { configId: 'turbo', value: true })).status,
    400
  )
  await post(`/api/agent/sessions/${id}/prompt`, { text: 'reconfig' })
  await stream.waitFor(
    events => stream.stopped(events) && events.at(-1)?.event.type === 'status'
  )
  assert.equal(
    (await post(url, { configId: 'turbo', value: true })).status,
    204
  )
})

test('an answer to a permission request must be one of the options offered', async t => {
  const { address, post, createSession } = await setup(t)
  const id = await createSession()
  const stream = openEvents(t, address, id)

  await post(`/api/agent/sessions/${id}/prompt`, { text: 'edit' })
  await stream.waitFor(events =>
    events.some(e => e.event.type === 'permission')
  )
  const request = stream.events.find(e => e.event.type === 'permission')!.event
  assert.ok(request.type === 'permission')
  const url = `/api/agent/sessions/${id}/permissions/${request.requestId}`

  assert.equal((await post(url, { optionId: 'made-up' })).status, 400)
  assert.equal((await post(url, { optionId: 'allow' })).status, 204)
  await stream.waitFor(stream.stopped)
})

test('late subscribers and Last-Event-ID reconnects get the missed events without duplicates', async t => {
  const { address, post, createSession } = await setup(t)
  const id = await createSession()
  const first = openEvents(t, address, id)
  await post(`/api/agent/sessions/${id}/prompt`, { text: 'hello' })
  await first.waitFor(
    events => first.stopped(events) && events.at(-1)?.event.type === 'status'
  )

  const late = openEvents(t, address, id)
  await late.waitFor(events => events.length >= first.events.length)
  assert.deepEqual(late.events, first.events)

  const afterThree = openEvents(t, address, id, 3)
  await afterThree.waitFor(events => events.length >= first.events.length - 3)
  assert.deepEqual(afterThree.events, first.events.slice(3))
})

test('after the server closes, the agent process is gone', async t => {
  const { app, address, post, createSession } = await setup(t)
  const id = await createSession()
  const stream = openEvents(t, address, id)
  await post(`/api/agent/sessions/${id}/prompt`, { text: 'pid' })
  await stream.waitFor(events => events.some(e => e.event.type === 'stop'))
  const pid = Number(/pid:(\d+)/.exec(stream.text())![1])
  process.kill(pid, 0) // alive

  await app.close()

  const deadline = Date.now() + 5_000
  for (;;) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    assert.ok(
      Date.now() < deadline,
      'agent process still running after app.close()'
    )
    await new Promise(resolve => setTimeout(resolve, 50))
  }
})

test('sessions run side by side on one stream with ids that keep rising; the number of chats is capped', async t => {
  const { address, post, createSession, app } = await setup(t)
  const stream = openEvents(t, address, null)
  const first = await createSession('fake', 'one')
  const second = await createSession('fake', 'two')
  await post(`/api/agent/sessions/${first}/prompt`, { text: 'hello' })
  await post(`/api/agent/sessions/${second}/prompt`, { text: 'world' })
  await stream.waitFor(
    events =>
      new Set(events.filter(e => e.event.type === 'stop').map(e => e.id))
        .size === 2
  )

  const bySession = (id: string) => stream.all.filter(e => e.sessionId === id)
  assert.match(
    bySession(first)
      .filter(e => e.event.type === 'message')
      .map(e => (e.event.type === 'message' ? e.event.text : ''))
      .join(''),
    /echo:hello/
  )
  assert.match(
    bySession(second)
      .filter(e => e.event.type === 'message')
      .map(e => (e.event.type === 'message' ? e.event.text : ''))
      .join(''),
    /echo:world/
  )
  const ids = stream.all.map(e => e.id)
  assert.deepEqual(
    ids,
    [...ids].sort((a, b) => a - b),
    'one counter, in stream order'
  )
  assert.equal(new Set(ids).size, ids.length)

  for (let i = 2; i < MAX_AGENT_SESSIONS; i++) {
    await createSession()
  }
  const over = await post('/api/agent/sessions', { presetId: 'fake' })
  assert.equal(over.status, 409)
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/agent/sessions' })).json()
      .length,
    MAX_AGENT_SESSIONS
  )

  await app.inject({ method: 'DELETE', url: `/api/agent/sessions/${first}` })
  assert.equal(
    (await post('/api/agent/sessions', { presetId: 'fake' })).status,
    201,
    'closing a chat frees its slot'
  )
})

test('opening and closing a session nudges every stream to re-read the list', async t => {
  const { address, app, createSession } = await setup(t)
  const stream = openEvents(t, address, null)
  const id = await createSession()
  await stream.waitFor(() => stream.frames.some(f => f.event === 'sessions'))
  const before = stream.frames.filter(f => f.event === 'sessions').length

  await app.inject({ method: 'DELETE', url: `/api/agent/sessions/${id}` })
  const deadline = Date.now() + 5_000
  while (stream.frames.filter(f => f.event === 'sessions').length <= before) {
    assert.ok(Date.now() < deadline, 'no "sessions" frame after closing')
    await sleep(20)
  }
})

for (const embedded of [true, false]) {
  test(`context is attached (embeddedContext ${embedded ? 'supported' : 'unsupported → fenced text'})`, async t => {
    const preset = fakePreset('fake', { FAKE_EMBEDDED: embedded ? '1' : '0' })
    const { address, post, createSession, fixture } = await setup(t, [preset])
    mkdirSync(join(fixture.dir, 'src'))
    writeFileSync(join(fixture.dir, 'src', 'a.ts'), 'const a = 1 // ```\n')
    await fixture.git.add('.')
    const id = await createSession()
    const stream = openEvents(t, address, id)

    // a review to attach
    const reviewRes = await fetch(new URL('/api/reviews', address), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceType: 'staged' })
    })
    const review = (await reviewRes.json()) as { id: string }

    const res = await post(`/api/agent/sessions/${id}/prompt`, {
      text: 'look',
      context: [
        { kind: 'diff', source: 'staged', path: 'src/a.ts' },
        { kind: 'file', path: 'src/a.ts' },
        { kind: 'directory', path: 'src' },
        { kind: 'review', reviewId: review.id }
      ]
    })
    assert.equal(res.status, 202)
    await stream.waitFor(stream.stopped)

    const text = stream.text()
    assert.match(
      text,
      /\+const a = 1 \/\/ ```/,
      'diff content reaches the agent'
    )
    assert.match(text, /link:file:\/\/.*src\/a\.ts/, 'file is passed as a link')
    assert.match(
      text,
      /link:file:\/\/\S*\/src\/(\s|$)/,
      'a directory is passed as a link that ends with a slash'
    )
    assert.match(text, /a\.ts/, 'review markdown mentions the file')
    if (!embedded) {
      // fence must be longer than the ``` inside the diff
      assert.match(text, /````\n--- /)
    }
  })
}

test('context with paths/refs outside the repository or nothing to attach → 400', async t => {
  const { post, createSession } = await setup(t)
  const id = await createSession()
  for (const context of [
    [{ kind: 'file', path: '../../etc/passwd' }],
    [{ kind: 'file', path: '/etc/passwd' }],
    [{ kind: 'file', path: 'does-not-exist.txt' }],
    [{ kind: 'directory', path: '../outside' }],
    [{ kind: 'directory', path: '/' }],
    [{ kind: 'directory', path: '.' }],
    [{ kind: 'directory', path: 'src/..' }],
    [{ kind: 'directory', path: 'src/a.ts' }],
    [{ kind: 'file', path: 'src' }],
    [{ kind: 'diff', source: 'staged' }],
    [{ kind: 'review', reviewId: 'nope' }]
  ]) {
    const res = await post(`/api/agent/sessions/${id}/prompt`, {
      text: 'x',
      context
    })
    assert.equal(res.status, 400, JSON.stringify(context))
  }
})

test('attachments: images go as image blocks, text files embedded, binaries as file links', async t => {
  const { app, address, post, createSession } = await setup(t)
  const id = await createSession()
  const stream = openEvents(t, address, id)

  const res = await post(`/api/agent/sessions/${id}/prompt`, {
    text: 'look',
    context: [
      {
        kind: 'attachment',
        name: 'shot.png',
        mimeType: 'image/png',
        data: PNG
      },
      {
        kind: 'attachment',
        name: 'notes.txt',
        mimeType: 'text/plain',
        data: Buffer.from('hello from notes').toString('base64')
      },
      {
        kind: 'attachment',
        // A hostile name must not leave the session's attachment directory.
        name: '../../blob.bin',
        mimeType: 'application/octet-stream',
        data: Buffer.from([0, 1, 2, 255]).toString('base64')
      }
    ]
  })
  assert.equal(res.status, 202)
  await stream.waitFor(stopped)

  const text = stream.text()
  assert.ok(text.includes(`image:image/png:${PNG}`), 'image block')
  assert.match(text, /hello from notes/, 'text file embedded')
  const link = /link:(file:\/\/\S+\/blob\.bin)/.exec(text)?.[1]
  assert.ok(link, 'binary passed as a file link')
  const path = fileURLToPath(link)
  const dir = join(tmpdir(), 'githuman-agent', id)
  assert.ok(path.startsWith(dir + sep), `${path} is inside ${dir}`)
  assert.deepEqual([...readFileSync(path)], [0, 1, 2, 255])

  await app.inject({ method: 'DELETE', url: `/api/agent/sessions/${id}` })
  await sleep(100)
  assert.equal(existsSync(dir), false, 'removed when the session closes')
})

test('an image for an agent without image support → 400', async t => {
  const preset = fakePreset('fake', { FAKE_IMAGE: '0' })
  const { post, createSession } = await setup(t, [preset])
  const id = await createSession()
  const res = await post(`/api/agent/sessions/${id}/prompt`, {
    text: 'x',
    context: [
      { kind: 'attachment', name: 'shot.png', mimeType: 'image/png', data: PNG }
    ]
  })
  assert.equal(res.status, 400)
})

test('the agent’s settings (configOptions) are published at start, groups flattened', async t => {
  const { address, createSession } = await setup(t)
  const id = await createSession()
  const stream = openEvents(t, address, id)
  await stream.waitFor(events => events.some(e => e.event.type === 'config'))

  const config = stream.events.find(e => e.event.type === 'config')?.event
  assert.ok(config?.type === 'config')
  assert.deepEqual(config.options, [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: 'm1',
      options: [
        { value: 'm1', name: 'Model 1', group: 'Group one' },
        {
          value: 'm2',
          name: 'Model 2',
          description: 'second',
          group: 'Group one'
        },
        { value: 'm3', name: 'Model 3', group: 'Group two' }
      ]
    },
    { id: 'fast', name: 'Fast', type: 'boolean', currentValue: false }
  ])
})

test('changing a setting reaches the agent and republishes the options', async t => {
  const { address, post, createSession } = await setup(t)
  const id = await createSession()
  const stream = openEvents(t, address, id)

  assert.equal(
    (
      await post(`/api/agent/sessions/${id}/config`, {
        configId: 'model',
        value: 'm3'
      })
    ).status,
    204
  )
  assert.equal(
    (
      await post(`/api/agent/sessions/${id}/config`, {
        configId: 'fast',
        value: true
      })
    ).status,
    204
  )
  await post(`/api/agent/sessions/${id}/prompt`, { text: 'settings' })
  await stream.waitFor(stopped)

  assert.equal(stream.text(), 'model:m3 fast:true')
  const last = stream.events
    .filter(e => e.event.type === 'config')
    .at(-1)?.event
  assert.ok(last?.type === 'config')
  assert.equal(last.options[0]?.currentValue, 'm3')
  assert.equal(last.options[1]?.currentValue, true)
})

test('settings changes the agent never offered are rejected before reaching it', async t => {
  const { post, createSession } = await setup(t)
  const id = await createSession()
  const url = `/api/agent/sessions/${id}/config`

  for (const body of [
    { configId: 'nope', value: 'x' },
    { configId: 'model', value: 'not-a-model' },
    { configId: 'model', value: true },
    { configId: 'fast', value: 'yes' }
  ]) {
    assert.equal((await post(url, body)).status, 400, JSON.stringify(body))
  }
  assert.equal(
    (
      await post('/api/agent/sessions/nope/config', {
        configId: 'a',
        value: 'b'
      })
    ).status,
    404
  )
})

test('settings cannot be changed while the agent is answering', async t => {
  const { address, post, createSession } = await setup(t)
  const id = await createSession()
  const stream = openEvents(t, address, id)
  await post(`/api/agent/sessions/${id}/prompt`, { text: 'slow' })
  await stream.waitFor(events => events.some(e => e.event.type === 'message'))

  const res = await post(`/api/agent/sessions/${id}/config`, {
    configId: 'model',
    value: 'm2'
  })
  assert.equal(res.status, 409)

  await post(`/api/agent/sessions/${id}/cancel`)
  await stream.waitFor(stopped)
})

test('GET /api/agent/sessions lists the active session so a reloaded page can reattach', async t => {
  const { app, createSession } = await setup(t)
  assert.deepEqual(
    (await app.inject({ method: 'GET', url: '/api/agent/sessions' })).json(),
    []
  )
  const id = await createSession()
  const list = (
    await app.inject({ method: 'GET', url: '/api/agent/sessions' })
  ).json()
  assert.deepEqual(list, [
    {
      id,
      presetId: 'fake',
      name: 'Fake',
      status: 'ready',
      reviewId: null,
      autoApprove: false,
      error: null
    }
  ])
})

test('creating a session for an unknown review → 404', async t => {
  const { post } = await setup(t)
  assert.equal(
    (await post('/api/agent/sessions', { presetId: 'fake', reviewId: 'nope' }))
      .status,
    404
  )
})

test('a request still open when the turn fails is cancelled — answering it later finds nothing', async t => {
  const { address, post, createSession } = await setup(t)
  const id = await createSession()
  const stream = openEvents(t, address, id)

  await post(`/api/agent/sessions/${id}/prompt`, { text: 'askfail' })
  await stream.waitFor(events => events.some(e => e.event.type === 'error'))
  await stream.waitFor(events =>
    events.some(e => e.event.type === 'permission-resolved')
  )
  const request = stream.events.find(e => e.event.type === 'permission')!.event
  assert.ok(request.type === 'permission')
  assert.equal(
    (
      await post(`/api/agent/sessions/${id}/permissions/${request.requestId}`, {
        optionId: 'allow'
      })
    ).status,
    404
  )
})

test('auto-approve is off by default and answers requests itself once switched on', async t => {
  const { address, post, createSession, sessionInfo } = await setup(t)
  const id = await createSession()
  const stream = openEvents(t, address, id)
  assert.equal((await sessionInfo(id)).autoApprove, false)

  assert.equal(
    (await post(`/api/agent/sessions/${id}/auto-approve`, { enabled: true }))
      .status,
    204
  )
  assert.equal((await sessionInfo(id)).autoApprove, true)

  await post(`/api/agent/sessions/${id}/prompt`, { text: 'edit' })
  await stream.waitFor(stream.stopped)

  assert.equal(stream.text(), 'edited')
  assert.ok(
    !stream.events.some(e => e.event.type === 'permission'),
    'the user is never asked'
  )
  const audit = stream.events.find(e => e.event.type === 'auto-approved')?.event
  assert.deepEqual(audit, { type: 'auto-approved', title: 'Write a.txt' })
  assert.ok(
    stream.events.some(e => e.event.type === 'auto-approve' && e.event.enabled)
  )
})

test('switching auto-approve on also grants the requests already waiting', async t => {
  const { address, post, createSession } = await setup(t)
  const id = await createSession()
  const stream = openEvents(t, address, id)

  await post(`/api/agent/sessions/${id}/prompt`, { text: 'edit' })
  await stream.waitFor(events =>
    events.some(e => e.event.type === 'permission')
  )
  await post(`/api/agent/sessions/${id}/auto-approve`, { enabled: true })
  await stream.waitFor(stream.stopped)
  assert.equal(stream.text(), 'edited')
})

test('auto-approve is per chat and can be switched off again', async t => {
  const { address, post, createSession, sessionInfo } = await setup(t)
  const one = await createSession()
  const two = await createSession()
  await post(`/api/agent/sessions/${one}/auto-approve`, { enabled: true })
  assert.equal((await sessionInfo(two)).autoApprove, false)

  await post(`/api/agent/sessions/${one}/auto-approve`, { enabled: false })
  const stream = openEvents(t, address, one)
  await post(`/api/agent/sessions/${one}/prompt`, { text: 'edit' })
  await stream.waitFor(events =>
    events.some(e => e.event.type === 'permission')
  )
  assert.equal((await sessionInfo(one)).autoApprove, false)
  assert.equal(
    (await post('/api/agent/sessions/nope/auto-approve', { enabled: true }))
      .status,
    404
  )
  assert.equal(
    (await post(`/api/agent/sessions/${one}/auto-approve`, { enabled: 'yes' }))
      .status,
    400
  )
})

test('file search ranks by file name, ignores deleted files and never takes the query to git', async t => {
  const { app, fixture } = await setup(t)
  mkdirSync(join(fixture.dir, 'src', 'deep'), { recursive: true })
  writeFileSync(join(fixture.dir, 'src', 'agent.ts'), '')
  writeFileSync(join(fixture.dir, 'src', 'deep', 'my-agent.ts'), '')
  writeFileSync(join(fixture.dir, 'src', 'other.ts'), '')
  writeFileSync(join(fixture.dir, 'notes agent.md'), '')
  const search = async (q: string, extra = '') =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/agent/files?q=${encodeURIComponent(q)}${extra}`
      })
    ).json<{ paths: string[] }>()

  assert.deepEqual((await search('agent')).paths, [
    'src/agent.ts',
    'notes agent.md',
    'src/deep/my-agent.ts'
  ])
  assert.deepEqual((await search('agent', '&limit=1')).paths, ['src/agent.ts'])
  assert.deepEqual((await search('--upload-pack=x')).paths, [])
  assert.deepEqual((await search('NOPE')).paths, [])
  // Directories come from the file list, with a trailing slash (#80).
  assert.deepEqual((await search('deep')).paths, [
    'src/deep/',
    'src/deep/my-agent.ts'
  ])
  // A removed directory is not offered, whatever list the index holds.
  rmSync(join(fixture.dir, 'src', 'deep'), { recursive: true })
  assert.deepEqual((await search('deep')).paths, [])

  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/agent/files?limit=0' }))
      .statusCode,
    400
  )
})

test('open chats keep distinct names: a taken one gets (1), (2), …', async t => {
  const { sessionInfo, createSession } = await setup(t)
  const first = await createSession('fake', 'Claude')
  const second = await createSession('fake', 'claude')
  const third = await createSession('fake', 'Claude')
  const names = await Promise.all(
    [first, second, third].map(async id => (await sessionInfo(id)).name)
  )
  assert.deepEqual(names, ['Claude', 'claude (1)', 'Claude (2)'])
})

test('a new stream gets the state of every chat as its own frame, before the events', async t => {
  const { address, post, createSession } = await setup(t)
  const id = await createSession()
  await post(`/api/agent/sessions/${id}/config`, {
    configId: 'model',
    value: 'm2'
  })

  const stream = openEvents(t, address, id)
  await stream.waitFor(events => events.length > 0)

  const frames = stream.frames.map(f => f.event)
  assert.ok(frames.includes('state'))
  assert.ok(frames.indexOf('state') < frames.indexOf('agent'))
  const frame = stream.frames.find(f => f.event === 'state')
  const state = frame?.data as AgentSessionState
  assert.equal(state.sessionId, id)
  assert.equal(state.status, 'ready')
  assert.equal(state.config.find(o => o.id === 'model')?.currentValue, 'm2')
})
