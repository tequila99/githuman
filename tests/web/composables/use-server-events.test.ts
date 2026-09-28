import { test, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { useServerEvents as UseServerEvents } from '@/composables/use-server-events'

// Node has no EventSource; this fake records instances so tests can drive
// open/error/named events by hand.
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
let useServerEvents: typeof UseServerEvents
let moduleVersion = 0

function latest(): FakeEventSource {
  const source = FakeEventSource.instances.at(-1)
  assert.ok(source, 'expected an EventSource to have been created')
  return source
}

beforeEach(async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  FakeEventSource.instances = []
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
  // The connection lives in module state for the lifetime of the tab, so
  // each test imports a fresh copy of the module.
  const module = (await import(
    `../../../src/web/composables/use-server-events.ts?v=${++moduleVersion}`
  )) as { useServerEvents: typeof UseServerEvents }
  useServerEvents = module.useServerEvents
})

afterEach(() => {
  mock.timers.reset()
  globalThis.EventSource = originalEventSource
})

test('subscribers share one EventSource, opened on first use', () => {
  assert.equal(FakeEventSource.instances.length, 0)

  useServerEvents(['files:changed'], () => {})
  useServerEvents(['review:created'], () => {})

  assert.equal(FakeEventSource.instances.length, 1)
  assert.equal(latest().url, '/api/events')
})

test('events reach only the subscribers of that type', () => {
  const files = mock.fn()
  const reviews = mock.fn()
  useServerEvents(['files:changed'], files)
  useServerEvents(['review:created', 'review:deleted'], reviews)

  latest().emit('files:changed')
  latest().emit('review:deleted')

  assert.equal(files.mock.callCount(), 1)
  assert.equal(reviews.mock.callCount(), 1)
})

test('close() unsubscribes without closing the shared connection', () => {
  const onChange = mock.fn()
  const handle = useServerEvents(['files:changed'], onChange)

  handle.close()
  latest().emit('files:changed')

  assert.equal(onChange.mock.callCount(), 0)
  assert.notEqual(latest().readyState, FakeEventSource.CLOSED)
})

test('the first open does not call onChange, a reconnect calls every subscriber', () => {
  const first = mock.fn()
  const second = mock.fn()
  useServerEvents(['files:changed'], first)
  useServerEvents(['review:created'], second)

  latest().emitOpen()
  assert.equal(first.mock.callCount(), 0)
  assert.equal(second.mock.callCount(), 0)

  latest().fail(false) // transient drop, the browser reconnects on its own
  latest().emitOpen()
  assert.equal(first.mock.callCount(), 1)
  assert.equal(second.mock.callCount(), 1)
  assert.equal(FakeEventSource.instances.length, 1)
})

test('a first connect after failed attempts catches up (backend was down on load)', () => {
  const onChange = mock.fn()
  useServerEvents(['files:changed'], onChange)

  latest().fail(false)
  latest().emitOpen()

  assert.equal(onChange.mock.callCount(), 1)
})

test('a permanently closed connection is recreated after a delay, then catches up', () => {
  const onChange = mock.fn()
  useServerEvents(['files:changed'], onChange)
  latest().emitOpen()

  latest().fail(true)
  assert.equal(FakeEventSource.instances.length, 1, 'waits before recreating')

  mock.timers.tick(2000)
  assert.equal(FakeEventSource.instances.length, 2)

  latest().emitOpen()
  assert.equal(onChange.mock.callCount(), 1)

  latest().emit('files:changed')
  assert.equal(
    onChange.mock.callCount(),
    2,
    'events flow on the new connection'
  )
})

test('a throwing subscriber does not stop the others from being notified', t => {
  t.mock.method(console, 'error', () => {})
  const other = mock.fn()
  useServerEvents(['files:changed'], () => {
    throw new Error('boom')
  })
  useServerEvents(['files:changed'], other)

  latest().emit('files:changed')

  assert.equal(other.mock.callCount(), 1)
})
