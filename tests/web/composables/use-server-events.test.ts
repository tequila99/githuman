import { test, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { useServerEvents } from '@/composables/use-server-events'

// Node has no EventSource; this fake records instances so tests can drive
// open/error/message events by hand.
class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static instances: FakeEventSource[] = []

  url: string
  readyState = FakeEventSource.CONNECTING

  constructor(url: string) {
    super()
    this.url = url
    FakeEventSource.instances.push(this)
  }

  close() {
    this.readyState = FakeEventSource.CLOSED
  }

  emitOpen() {
    this.readyState = FakeEventSource.OPEN
    this.dispatchEvent(new Event('open'))
  }

  emit(type: string) {
    this.dispatchEvent(new Event(type))
  }

  fail(permanently: boolean) {
    this.readyState = permanently
      ? FakeEventSource.CLOSED
      : FakeEventSource.CONNECTING
    this.dispatchEvent(new Event('error'))
  }
}

const originalEventSource = globalThis.EventSource
const openHandles: Array<{ close: () => void }> = []

function subscribe(types: string[], onChange: () => void) {
  const handle = useServerEvents(types, onChange)
  openHandles.push(handle)
  return handle
}

function latest(): FakeEventSource {
  const source = FakeEventSource.instances.at(-1)
  assert.ok(source, 'expected an EventSource to have been created')
  return source
}

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] })
  FakeEventSource.instances = []
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
})

afterEach(() => {
  // The composable keeps module-level state; fully close it between tests.
  for (const handle of openHandles.splice(0)) handle.close()
  mock.timers.tick(10_000)
  mock.timers.reset()
  globalThis.EventSource = originalEventSource
})

test('subscribers share one EventSource connection', () => {
  subscribe(['files:changed'], () => {})
  subscribe(['review:created'], () => {})

  assert.equal(FakeEventSource.instances.length, 1)
  assert.equal(latest().url, '/api/events')
})

test('events reach only the subscribers of that type', () => {
  const files = mock.fn()
  const reviews = mock.fn()
  subscribe(['files:changed'], files)
  subscribe(['review:created', 'review:deleted'], reviews)

  latest().emit('files:changed')
  latest().emit('review:deleted')

  assert.equal(files.mock.callCount(), 1)
  assert.equal(reviews.mock.callCount(), 1)
})

test('the first open does not call onChange, a reconnect calls every subscriber', () => {
  const first = mock.fn()
  const second = mock.fn()
  subscribe(['files:changed'], first)
  subscribe(['review:created'], second)

  latest().emitOpen()
  assert.equal(first.mock.callCount(), 0)
  assert.equal(second.mock.callCount(), 0)

  latest().fail(false) // transient drop, browser reconnects on its own
  latest().emitOpen()
  assert.equal(first.mock.callCount(), 1)
  assert.equal(second.mock.callCount(), 1)
  assert.equal(FakeEventSource.instances.length, 1)
})

test('a permanently closed connection is recreated and treated as a reconnect', () => {
  const onChange = mock.fn()
  subscribe(['files:changed'], onChange)
  latest().emitOpen()

  latest().fail(true)
  assert.equal(FakeEventSource.instances.length, 1, 'waits before recreating')

  mock.timers.tick(2000)
  assert.equal(FakeEventSource.instances.length, 2)

  latest().emitOpen()
  assert.equal(onChange.mock.callCount(), 1)
})

test('the connection closes once the last subscriber leaves', () => {
  const a = subscribe(['files:changed'], () => {})
  const b = subscribe(['review:created'], () => {})
  const source = latest()

  a.close()
  mock.timers.tick(0)
  assert.notEqual(source.readyState, FakeEventSource.CLOSED)

  b.close()
  mock.timers.tick(0)
  assert.equal(source.readyState, FakeEventSource.CLOSED)
})

test('unsubscribe then subscribe in the same tick (route change) keeps the connection', () => {
  const oldPage = subscribe(['review:created'], () => {})
  const source = latest()

  oldPage.close()
  const onChange = mock.fn()
  subscribe(['files:changed'], onChange)
  mock.timers.tick(0)

  assert.equal(FakeEventSource.instances.length, 1)
  assert.notEqual(source.readyState, FakeEventSource.CLOSED)
  source.emit('files:changed')
  assert.equal(onChange.mock.callCount(), 1)
})

test('a new subscriber after a full close gets a fresh connection whose first open is silent', () => {
  subscribe(['files:changed'], () => {}).close()
  mock.timers.tick(0)

  const onChange = mock.fn()
  subscribe(['files:changed'], onChange)
  assert.equal(FakeEventSource.instances.length, 2)

  latest().emitOpen()
  assert.equal(onChange.mock.callCount(), 0)
})

test('a first connect after failed attempts catches up (backend was down on load)', () => {
  const onChange = mock.fn()
  subscribe(['files:changed'], onChange)

  latest().fail(true)
  mock.timers.tick(2000)
  latest().emitOpen()

  assert.equal(onChange.mock.callCount(), 1)
})

test('subscribing while a reconnect is pending waits for it and gets its event types', () => {
  subscribe(['files:changed'], () => {})
  latest().emitOpen()
  latest().fail(true)

  const onChange = mock.fn()
  subscribe(['review:created'], onChange)
  assert.equal(FakeEventSource.instances.length, 1)

  mock.timers.tick(2000)
  assert.equal(FakeEventSource.instances.length, 2)
  latest().emit('review:created')
  assert.equal(onChange.mock.callCount(), 1)
})

test('no reconnect once every subscriber left during the reconnect delay', () => {
  const handle = subscribe(['files:changed'], () => {})
  latest().emitOpen()
  latest().fail(true)

  handle.close()
  mock.timers.tick(2000)

  assert.equal(FakeEventSource.instances.length, 1)
})

test('closing the same handle twice does not close a connection others still use', () => {
  const a = subscribe(['files:changed'], () => {})
  subscribe(['review:created'], () => {})
  const source = latest()

  a.close()
  a.close()
  mock.timers.tick(0)

  assert.notEqual(source.readyState, FakeEventSource.CLOSED)
})

test('a throwing subscriber does not stop the others from being notified', t => {
  t.mock.method(console, 'error', () => {})
  const other = mock.fn()
  subscribe(['files:changed'], () => {
    throw new Error('boom')
  })
  subscribe(['files:changed'], other)

  latest().emit('files:changed')

  assert.equal(other.mock.callCount(), 1)
})

test('events from a superseded connection are ignored', () => {
  const onChange = mock.fn()
  subscribe(['files:changed'], onChange)
  const stale = latest()
  stale.emitOpen()
  stale.fail(true)
  mock.timers.tick(2000)
  const live = latest()
  assert.notEqual(live, stale)

  stale.emit('files:changed')
  stale.emitOpen()
  stale.fail(true)
  assert.equal(onChange.mock.callCount(), 0)
  assert.equal(
    FakeEventSource.instances.length,
    2,
    'stale error must not schedule a reconnect'
  )
  mock.timers.tick(2000)
  assert.equal(FakeEventSource.instances.length, 2)

  live.emit('files:changed')
  assert.equal(onChange.mock.callCount(), 1)
})
