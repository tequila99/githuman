import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { TERMINAL_SNAPSHOT_BYTES } from '../../../../src/shared/terminal/constants.ts'
import { TerminalRegistry } from '../../../../src/server/services/terminal/registry.ts'
import {
  attachTerminalSocket,
  type TerminalSocketOptions
} from '../../../../src/server/services/terminal/socket.ts'
import { FakeBackend } from './fake-backend.ts'

class FakeSocket extends EventEmitter {
  readonly OPEN = 1
  readyState = 1
  bufferedAmount = 0
  sent: string[] = []
  pings = 0
  terminated = 0
  sendError?: Error
  send(data: string, callback: (error?: Error) => void): void {
    this.sent.push(data)
    callback(this.sendError)
  }
  ping(): void {
    this.pings++
  }
  terminate(): void {
    this.terminated++
  }
}

function attach(
  t: { after: (fn: () => unknown) => void },
  options?: TerminalSocketOptions
) {
  const registry = new TerminalRegistry({
    repositoryPath: '/tmp',
    backend: async () => new FakeBackend()
  })
  const socket = new FakeSocket()
  const connection = attachTerminalSocket(socket, registry, options)
  t.after(() => {
    socket.emit('close')
    return registry.dispose()
  })
  return { socket, connection, registry }
}

test('the socket receives the session list when it attaches', t => {
  const { socket } = attach(t)
  assert.equal(JSON.parse(socket.sent[0] ?? '{}').type, 'list')
})

test('a binary frame or invalid JSON closes the socket', t => {
  const { socket } = attach(t)
  socket.emit('message', Buffer.from('{}'), true)
  assert.equal(socket.terminated, 1)
  socket.emit('message', Buffer.from('not json'), false)
  assert.equal(socket.terminated, 2)
})

test('a fragmented text message is joined before parsing', t => {
  const { socket } = attach(t)
  socket.emit(
    'message',
    [Buffer.from('{"type":'), Buffer.from('"bad"}')],
    false
  )
  // The channel rejects the unknown type, so the parse itself worked.
  assert.equal(socket.terminated, 1)
})

test('a client with too much unsent data is disconnected', async t => {
  const { socket, registry } = attach(t)
  socket.bufferedAmount = TERMINAL_SNAPSHOT_BYTES + 1
  const before = socket.sent.length
  // A new session makes the registry publish a list to the socket.
  await registry.create(80, 24)
  assert.equal(socket.sent.length, before)
  assert.equal(socket.terminated, 1)
})

test('a failed send closes the socket', t => {
  const registry = new TerminalRegistry({
    repositoryPath: '/tmp',
    backend: async () => new FakeBackend()
  })
  t.after(() => registry.dispose())
  const socket = new FakeSocket()
  socket.sendError = new Error('write failed')
  attachTerminalSocket(socket, registry)
  assert.equal(socket.terminated, 1)
})

test('heartbeat pings a live peer and closes a peer that misses a pong', t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const { socket } = attach(t, { heartbeatMs: 10 })
  t.mock.timers.tick(10)
  assert.equal(socket.pings, 1)
  socket.emit('pong')
  t.mock.timers.tick(10)
  assert.equal(socket.pings, 2)
  assert.equal(socket.terminated, 0)
  t.mock.timers.tick(10)
  assert.equal(socket.pings, 2)
  assert.equal(socket.terminated, 1)
})

test('onDisconnect runs once for close and error together', t => {
  let calls = 0
  const { socket } = attach(t, { onDisconnect: () => calls++ })
  socket.emit('error')
  socket.emit('close')
  assert.equal(calls, 1)
})
