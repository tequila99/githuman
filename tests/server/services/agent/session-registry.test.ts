import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  createSessionRegistry,
  type AgentStreamMessage
} from '../../../../src/server/services/agent/session-registry.ts'
import type { AgentPreset } from '../../../../src/shared/agents/types.ts'

const preset: AgentPreset = {
  id: 'fake',
  title: 'Fake',
  command: process.execPath,
  args: [join(import.meta.dirname, '../../fixtures/fake-acp-agent.ts')],
  autoApprovesEdits: false
}

async function untilReady(
  registry: ReturnType<typeof createSessionRegistry>,
  id: string
) {
  const deadline = Date.now() + 10_000
  while (registry.get(id)?.status === 'starting') {
    assert.ok(Date.now() < deadline, 'session did not start')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

test('a subscriber that fell behind the buffer is told about the gap, then gets what is left in order', async t => {
  const registry = createSessionRegistry({
    presets: [preset],
    repositoryPath: process.cwd(),
    bufferLimit: 4
  })
  t.after(() => registry.closeAll())
  const session = registry.create('fake', null)
  await untilReady(registry, session.id)
  session.prompt([{ type: 'text', text: 'hello' }], { text: 'hello' })
  const deadline = Date.now() + 10_000
  while (session.status !== 'ready' || session.replay(0).envelopes.length < 4) {
    assert.ok(Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  const seen: AgentStreamMessage[] = []
  const unsubscribe = registry.subscribe(m => seen.push(m), 1)
  unsubscribe()
  assert.deepEqual(seen[0], { type: 'gap', sessionId: session.id })
  // The state follows the gap marker and precedes every replayed event.
  assert.equal(seen[1]?.type, 'state')
  assert.equal(
    seen.findIndex(m => m.type === 'event'),
    2
  )
  const ids = seen.flatMap(m => (m.type === 'event' ? [m.envelope.id] : []))
  assert.equal(ids.length, 4, 'only the buffer limit survives')
  assert.deepEqual(
    ids,
    [...ids].sort((a, b) => a - b)
  )

  // Nothing was lost for a subscriber that is up to date: no gap marker.
  const current: AgentStreamMessage[] = []
  registry.subscribe(m => current.push(m), ids.at(-1))()
  assert.deepEqual(current, [])

  // A new client (no Last-Event-ID) gets the state even without a gap.
  const fresh: AgentStreamMessage[] = []
  registry.subscribe(m => fresh.push(m))()
  const state = fresh.find(m => m.type === 'state')
  assert.ok(state?.type === 'state')
  assert.equal(state.state.status, 'ready')
  assert.ok(state.state.config.length > 0, 'settings survive the eviction')
  assert.equal(
    fresh.some(m => m.type === 'gap'),
    false
  )
})

test('replay merges the buffers of several sessions by id', async t => {
  const registry = createSessionRegistry({
    presets: [preset],
    repositoryPath: process.cwd()
  })
  t.after(() => registry.closeAll())
  const a = registry.create('fake', null, 'a')
  const b = registry.create('fake', null, 'b')
  await untilReady(registry, a.id)
  await untilReady(registry, b.id)

  const seen: AgentStreamMessage[] = []
  registry.subscribe(m => seen.push(m))()
  const ids = seen.flatMap(m => (m.type === 'event' ? [m.envelope.id] : []))
  assert.ok(ids.length >= 4)
  assert.deepEqual(
    ids,
    [...ids].sort((x, y) => x - y)
  )
  assert.deepEqual(
    new Set(
      seen.flatMap(m => (m.type === 'event' ? [m.envelope.sessionId] : []))
    ),
    new Set([a.id, b.id])
  )
})

test('the state lists the requests still waiting and the auto-approve switch', async t => {
  const registry = createSessionRegistry({
    presets: [preset],
    repositoryPath: process.cwd()
  })
  t.after(() => registry.closeAll())
  const session = registry.create('fake', null)
  await untilReady(registry, session.id)
  session.setAutoApprove(true)
  session.setAutoApprove(false)
  session.prompt([{ type: 'text', text: 'edit' }], { text: 'edit' })
  const deadline = Date.now() + 10_000
  while (session.state().permissions.length === 0) {
    assert.ok(Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  const state = session.state()
  assert.equal(state.status, 'busy')
  assert.equal(state.autoApprove, false)
  assert.equal(state.permissions[0]?.diffs[0]?.path, '/repo/a.txt')
})
