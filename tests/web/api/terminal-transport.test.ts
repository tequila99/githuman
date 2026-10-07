import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocketTerminalTransport } from '@/api/terminal-transport'

class Socket extends EventTarget {
  readyState = 0
  bufferedAmount = 0
  sent: string[] = []
  close(): void {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
  send(data: string): void {
    this.sent.push(data)
  }
}

test('transport obtains a fresh token and never queues disconnected input', async () => {
  const socket = new Socket()
  let url = ''
  let calls = 0
  const transport = new WebSocketTerminalTransport(
    async () => {
      calls++
      return { token: 'once' }
    },
    address => {
      url = address
      return socket as unknown as WebSocket
    },
    () => 'http://localhost:9000'
  )
  const states: string[] = []
  transport.onState(state => states.push(state))
  assert.equal(transport.send({ type: 'ping' }), false)
  transport.connect()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
  assert.equal(new URL(url).searchParams.get('token'), 'once')
  assert.equal(new URL(url).protocol, 'ws:')
  socket.readyState = 1
  socket.dispatchEvent(new Event('open'))
  assert.equal(transport.send({ type: 'ping' }), true)
  assert.deepEqual(socket.sent, ['{"type":"ping"}'])
  transport.close()
  assert.equal(transport.send({ type: 'ping' }), false)
  assert.deepEqual(states, ['connecting', 'connected', 'disconnected'])
})

test('disposing while token is pending cannot create a late socket', async () => {
  let finish: ((value: { token: string }) => void) | undefined
  let connections = 0
  const transport = new WebSocketTerminalTransport(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
    () => {
      connections++
      return new Socket() as unknown as WebSocket
    },
    () => 'http://localhost'
  )
  transport.connect()
  transport.close()
  finish?.({ token: 'late' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(connections, 0)
})
