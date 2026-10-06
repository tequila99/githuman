import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TerminalRegistry } from '../../../../src/server/services/terminal/registry.ts'
import { TerminalChannel } from '../../../../src/server/services/terminal/channel.ts'
import type { TerminalServerMessage } from '../../../../src/shared/terminal/types.ts'
import { FakeBackend } from './fake-backend.ts'

async function subscribe(channel: TerminalChannel, id: string): Promise<void> {
  channel.receive({ type: 'subscribe', terminalId: id })
  await new Promise(resolve => setImmediate(resolve))
}

test('two subscribers get output, but terminal queries are answered only once', async t => {
  const backend = new FakeBackend()
  const registry = new TerminalRegistry({
    repositoryPath: '/tmp',
    backend: async () => backend
  })
  t.after(() => registry.dispose())
  const session = await registry.create(80, 24)
  const first: TerminalServerMessage[] = []
  const second: TerminalServerMessage[] = []
  const one = new TerminalChannel(
    registry,
    message => first.push(message),
    () => {}
  )
  const two = new TerminalChannel(
    registry,
    message => second.push(message),
    () => {}
  )
  t.after(() => {
    one.dispose()
    two.dispose()
  })
  await subscribe(one, session.id)
  await subscribe(two, session.id)
  backend.data('\x1b[6n')
  await session.snapshot(() => {})
  assert.equal(backend.writes.length, 1)
  assert.equal(first.filter(message => message.type === 'output').length, 1)
  assert.equal(second.filter(message => message.type === 'output').length, 1)
  await session.snapshot(() => {})
  assert.equal(backend.writes.length, 1)
})

test('credit pauses a backend, acknowledgement resumes it, disconnect removes the pause', async t => {
  const backend = new FakeBackend()
  const registry = new TerminalRegistry({
    repositoryPath: '/tmp',
    backend: async () => backend
  })
  t.after(() => registry.dispose())
  const session = await registry.create(80, 24)
  let sequence = 0
  const channel = new TerminalChannel(
    registry,
    message => {
      if (message.type === 'output') sequence = message.sequence
    },
    () => {}
  )
  t.after(() => channel.dispose())
  await subscribe(channel, session.id)
  backend.data('x'.repeat(300_000))
  await session.snapshot(() => {})
  assert.equal(backend.paused, true)
  channel.receive({ type: 'ack', terminalId: session.id, sequence })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(backend.paused, false)
  backend.data('x'.repeat(300_000))
  await session.snapshot(() => {})
  assert.equal(backend.paused, true)
  channel.dispose()
  assert.equal(backend.paused, false)
  assert.equal(backend.killed, false)
})

test('a slow subscriber is disconnected and leaves the server session alive', async t => {
  const backend = new FakeBackend()
  const registry = new TerminalRegistry({
    repositoryPath: '/tmp',
    backend: async () => backend
  })
  t.after(() => registry.dispose())
  const session = await registry.create(80, 24)
  let disconnected = false
  const channel = new TerminalChannel(
    registry,
    () => {},
    () => {
      disconnected = true
      channel?.dispose()
    },
    10
  )
  t.after(() => channel?.dispose())
  await subscribe(channel, session.id)
  backend.data('x'.repeat(300_000))
  await session.snapshot(() => {})
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(disconnected, true)
  assert.equal(backend.paused, false)
  assert.equal(registry.list.length, 1)
})
