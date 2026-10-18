import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setActivePinia, createPinia } from 'pinia'
import { accessMode, useAccessStore } from '@/stores/access-store'

let originalFetch: typeof fetch

beforeEach(() => {
  setActivePinia(createPinia())
  originalFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('accessMode maps each status to the app, pairing or unavailable', () => {
  assert.equal(accessMode('local'), 'app')
  assert.equal(accessMode('device'), 'app')
  assert.equal(accessMode('pending'), 'pairing')
  assert.equal(accessMode('none'), 'pairing')
  assert.equal(accessMode(null), 'unavailable')
})

test('check reads the status and the pairing code', async () => {
  const pairing = {
    code: '123456',
    expiresAt: '2026-10-17T10:02:00.000Z',
    remainingMs: 120_000
  }
  globalThis.fetch = async () => Response.json({ status: 'pending', pairing })
  const store = useAccessStore()
  assert.equal(await store.check(), 'pending')
  assert.deepEqual(store.pairing, pairing)
  assert.equal(store.mode, 'pairing')
  assert.equal(store.isLocal, false)
})

test('check marks local access', async () => {
  globalThis.fetch = async () => Response.json({ status: 'local' })
  const store = useAccessStore()
  await store.check()
  assert.equal(store.isLocal, true)
  assert.equal(store.mode, 'app')
})

test('a foreign Host, a 5xx or a network error make the server unavailable', async () => {
  const store = useAccessStore()
  for (const answer of [
    async () => Response.json({ message: 'Unknown Host' }, { status: 403 }),
    async () => new Response('boom', { status: 502 }),
    async () => {
      throw new TypeError('Failed to fetch')
    }
  ]) {
    globalThis.fetch = answer
    assert.equal(await store.check(), null)
    assert.equal(store.mode, 'unavailable')
    assert.ok(store.error)
  }
})

test('requestAccess sends the name and keeps the pending answer', async () => {
  const bodies: unknown[] = []
  globalThis.fetch = async (_path, init) => {
    bodies.push(JSON.parse(typeof init?.body === 'string' ? init.body : 'null'))
    return Response.json({
      status: 'pending',
      pairing: {
        code: '000001',
        expiresAt: '2026-10-17T10:02:00.000Z',
        remainingMs: 120_000
      }
    })
  }
  const store = useAccessStore()
  await store.requestAccess('Phone')
  await store.requestAccess()
  assert.deepEqual(bodies, [{ name: 'Phone' }, {}])
  assert.equal(store.status, 'pending')
})

test('requestAccess passes a 429 to the caller', async () => {
  globalThis.fetch = async () =>
    Response.json({ message: 'Too frequent' }, { status: 429 })
  const store = useAccessStore()
  await assert.rejects(() => store.requestAccess(), /Too frequent/)
})

test('the pairing deadline follows the device clock; a network error keeps the code', async () => {
  const pairing = {
    code: '123456',
    expiresAt: '2000-01-01T00:02:00.000Z',
    remainingMs: 90_000
  }
  globalThis.fetch = async () => Response.json({ status: 'pending', pairing })
  const store = useAccessStore()
  const before = Date.now()
  await store.check()
  const deadline = Date.parse(store.pairingDeadline ?? '')
  assert.ok(deadline >= before + 90_000 && deadline <= Date.now() + 90_000)

  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch')
  }
  await store.check()
  assert.equal(store.mode, 'pairing')
  assert.equal(store.status, 'pending')
  assert.equal(store.pairing?.code, '123456')
  assert.ok(store.error)
})
