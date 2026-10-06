import { test } from 'node:test'
import assert from 'node:assert/strict'
import headless from '@xterm/headless'
import { TerminalRegistry } from '../../../../src/server/services/terminal/registry.ts'
import { FakeBackend } from './fake-backend.ts'
import type { TerminalServerMessage } from '../../../../src/shared/terminal/types.ts'
import {
  TERMINAL_IDLE_MS,
  TERMINAL_ORPHAN_MS
} from '../../../../src/shared/terminal/constants.ts'

test('registry atomically limits concurrent creates and releases closed slots', async t => {
  const registry = new TerminalRegistry({
    repositoryPath: '/tmp',
    backend: async () => new FakeBackend()
  })
  t.after(() => registry.dispose())
  const results = await Promise.allSettled(
    Array.from({ length: 9 }, () => registry.create(80, 24))
  )
  assert.equal(
    results.filter(result => result.status === 'fulfilled').length,
    8
  )
  assert.equal(registry.list.length, 8)
  await registry.close(registry.list[0].id)
  await registry.create(80, 24)
  assert.equal(registry.list.length, 8)
})

test('idle timeout starts at confirmed idle and reconnect cancels it', async t => {
  let now = 0
  const backend = new FakeBackend()
  const registry = new TerminalRegistry({
    repositoryPath: '/tmp',
    backend: async () => backend,
    now: () => now
  })
  t.after(() => registry.dispose())
  const session = await registry.create(80, 24)
  await registry.checkActivity()
  now = TERMINAL_IDLE_MS - 1
  await registry.checkActivity()
  assert.equal(registry.list.length, 1)
  const subscriber = {}
  registry.attach(session.id, subscriber)
  now += TERMINAL_ORPHAN_MS
  await registry.checkActivity()
  assert.equal(registry.list.length, 1)
  registry.detach(subscriber)
  now += TERMINAL_IDLE_MS
  await registry.checkActivity()
  assert.equal(registry.list.length, 0)
  assert.equal(backend.killed, true)
})

test('unknown and running use a hard orphan ceiling, not output activity', async t => {
  let now = 0
  const backend = new FakeBackend()
  backend.running = 'unknown'
  const registry = new TerminalRegistry({
    repositoryPath: '/tmp',
    backend: async () => backend,
    now: () => now
  })
  t.after(() => registry.dispose())
  await registry.create(80, 24)
  await registry.checkActivity()
  now = TERMINAL_IDLE_MS
  await registry.checkActivity()
  assert.equal(registry.list.length, 1)
  backend.running = 'running'
  now = TERMINAL_ORPHAN_MS
  await registry.checkActivity()
  assert.equal(registry.list.length, 0)
})

test('snapshot has an ordered output boundary and unfinished CSI tail', async t => {
  const backend = new FakeBackend()
  const registry = new TerminalRegistry({
    repositoryPath: '/tmp',
    backend: async () => backend
  })
  t.after(() => registry.dispose())
  const messages: TerminalServerMessage[] = []
  registry.subscribe(message => messages.push(message))
  const session = await registry.create(80, 24)
  backend.data('hello\x1b[31')
  let snapshot: TerminalServerMessage | null = null
  await session.snapshot(message => {
    snapshot = message
  })
  assert.ok(snapshot && (snapshot as TerminalServerMessage).type === 'snapshot')
  const result = snapshot as Extract<
    TerminalServerMessage,
    { type: 'snapshot' }
  >
  assert.equal(result.sequence, 1)
  assert.ok(result.data.endsWith('\x1b[31'))
  backend.data('mRED\x1b[6n')
  await session.snapshot(() => {})
  assert.equal(messages.filter(message => message.type === 'output').length, 2)
  assert.equal(backend.writes.length, 1)
  assert.match(backend.writes[0], /R$/)
})

test('snapshot preserves unfinished OSC and the alternate screen', async t => {
  const backend = new FakeBackend()
  const registry = new TerminalRegistry({
    repositoryPath: '/tmp',
    backend: async () => backend
  })
  t.after(() => registry.dispose())
  const session = await registry.create(80, 24)
  backend.data('MAIN\x1b[?1049hALT\x1b]0;partial')
  let data = ''
  await session.snapshot(message => {
    if (message.type === 'snapshot') data = message.data
  })
  assert.ok(data.endsWith('\x1b]0;partial'))
  const replay = new headless.Terminal({
    cols: 80,
    rows: 24,
    allowProposedApi: true
  })
  t.after(() => replay.dispose())
  let title = ''
  replay.onTitleChange(value => {
    title = value
  })
  await new Promise<void>(resolve => replay.write(data, resolve))
  assert.equal(replay.buffer.active.type, 'alternate')
  assert.match(
    replay.buffer.active.getLine(0)?.translateToString() ?? '',
    /ALT/
  )
  await new Promise<void>(resolve =>
    replay.write('-title\x07\x1b[?1049l', resolve)
  )
  assert.equal(title, 'partial-title')
  assert.equal(replay.buffer.active.type, 'normal')
  assert.match(
    replay.buffer.active.getLine(0)?.translateToString() ?? '',
    /MAIN/
  )
})

test('failed spawn releases reservation and disposal kills all sessions', async () => {
  let failing = true
  const backends: FakeBackend[] = []
  const registry = new TerminalRegistry({
    repositoryPath: '/tmp',
    backend: async () => {
      if (failing) throw new Error('spawn failed')
      const backend = new FakeBackend()
      backends.push(backend)
      return backend
    }
  })
  await assert.rejects(registry.create(80, 24), /spawn failed/)
  failing = false
  await registry.create(80, 24)
  await registry.dispose()
  assert.ok(backends.every(backend => backend.killed))
  await assert.rejects(registry.create(80, 24), /stopping/)
})
