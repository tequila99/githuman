import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useTerminalStore } from '@/stores/terminal-store'
import type {
  TerminalTransport,
  TerminalConnectionState
} from '@/api/terminal-transport'
import type {
  TerminalClientMessage,
  TerminalServerMessage,
  TerminalInfo
} from '../../../src/shared/terminal/types.ts'

class FakeTransport implements TerminalTransport {
  sent: TerminalClientMessage[] = []
  message: (message: TerminalServerMessage) => void = () => {}
  state: (state: TerminalConnectionState) => void = () => {}
  closed = false
  connect(): void {
    this.state('connected')
  }
  send(message: TerminalClientMessage): boolean {
    this.sent.push(message)
    return true
  }
  onMessage(listener: (message: TerminalServerMessage) => void): () => void {
    this.message = listener
    return () => {}
  }
  onState(listener: (state: TerminalConnectionState) => void): () => void {
    this.state = listener
    return () => {}
  }
  close(): void {
    this.closed = true
  }
}
function info(id: string): TerminalInfo {
  return { id, title: id, cols: 80, rows: 24, mode: 'pty', running: 'unknown' }
}
let store: ReturnType<typeof useTerminalStore>
beforeEach(() => {
  setActivePinia(createPinia())
  store = useTerminalStore()
})
afterEach(() => store.$dispose())

test('bootstrap discovers shared sessions without creating a shell', () => {
  const transport = new FakeTransport()
  store.init(true, transport)
  assert.equal(transport.sent.length, 0)
  transport.message({ type: 'list', sessions: [info('one'), info('two')] })
  assert.equal(store.activeId, 'one')
  assert.equal(store.sessions.length, 2)
  assert.equal(
    transport.sent.filter(message => message.type === 'subscribe').length,
    2
  )
  transport.message({ type: 'list', sessions: [info('one'), info('two')] })
  assert.equal(
    transport.sent.filter(message => message.type === 'subscribe').length,
    2
  )
})

test('open reserves a single create and another page create does not steal focus', () => {
  const transport = new FakeTransport()
  store.init(true, transport)
  store.show()
  store.show()
  assert.equal(
    transport.sent.filter(message => message.type === 'create').length,
    1
  )
  const request = transport.sent.find(message => message.type === 'create')
  assert.ok(request && request.type === 'create')
  transport.message({ type: 'list', sessions: [info('one')] })
  transport.message({
    type: 'created',
    terminalId: 'one',
    requestId: request.requestId
  })
  transport.message({ type: 'list', sessions: [info('one'), info('two')] })
  assert.equal(store.activeId, 'one')
  assert.equal(store.creating, false)
  store.minimize()
  assert.equal(store.minimized, true)
  store.show()
  assert.equal(store.minimized, false)
})

test('reload/reconnect requests snapshots and output without a view is acknowledged', () => {
  const transport = new FakeTransport()
  store.init(true, transport)
  transport.message({ type: 'list', sessions: [info('one')] })
  transport.message({
    type: 'snapshot',
    terminalId: 'one',
    data: 'screen',
    cols: 80,
    rows: 24,
    sequence: 1
  })
  transport.message({
    type: 'output',
    cols: 80,
    rows: 24,
    terminalId: 'one',
    data: 'data',
    sequence: 2
  })
  assert.ok(
    transport.sent.some(
      message => message.type === 'ack' && message.sequence === 2
    )
  )
  let delivered = 0
  const detach = store.attachView('one', () => {
    delivered++
  })
  assert.ok(transport.sent.some(message => message.type === 'snapshot'))
  transport.message({
    type: 'snapshot',
    terminalId: 'one',
    data: 'screen',
    cols: 80,
    rows: 24,
    sequence: 2
  })
  transport.message({
    type: 'output',
    cols: 80,
    rows: 24,
    terminalId: 'one',
    data: 'new',
    sequence: 3
  })
  assert.equal(delivered, 2)
  detach()
  transport.state('disconnected')
  transport.state('connected')
  transport.message({ type: 'list', sessions: [info('one')] })
  assert.equal(
    transport.sent.filter(message => message.type === 'subscribe').length,
    2
  )
  store.$dispose()
  assert.equal(transport.closed, true)
})

test('LAN capability never creates a transport', () => {
  const transport = new FakeTransport()
  store.init(false, transport)
  store.show()
  assert.equal(store.enabled, false)
  assert.equal(transport.sent.length, 0)
})
