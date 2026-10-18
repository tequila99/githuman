import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setActivePinia, createPinia } from 'pinia'
import { useDevicesStore } from '@/stores/devices-store'
import type { Device } from '@/api/types'

const DEVICE: Device = {
  id: 'd1',
  name: 'Phone',
  state: 'pending',
  host: '192.168.1.10:3847',
  address: '192.168.1.5',
  createdAt: '2026-10-17T10:00:00.000Z',
  expiresAt: '2026-10-17T10:02:00.000Z',
  lastSeenAt: '2026-10-17T10:00:00.000Z'
}

let originalFetch: typeof fetch

// The store passes string paths and JSON string bodies.
const text = (value: unknown) => (typeof value === 'string' ? value : '')

beforeEach(() => {
  setActivePinia(createPinia())
  originalFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('approve sends the code and refreshes the list', async () => {
  const calls: string[] = []
  let list: Device[] = [DEVICE]
  globalThis.fetch = async (path, init) => {
    calls.push(`${init?.method ?? 'GET'} ${text(path)} ${text(init?.body)}`)
    if (init?.method === 'POST') {
      list = [{ ...DEVICE, state: 'trusted' }]
      return Response.json(list[0])
    }
    return Response.json(list)
  }
  const store = useDevicesStore()
  await store.refresh()
  assert.equal(store.pending.length, 1)
  await store.approve(DEVICE, '654321')
  assert.deepEqual(calls.slice(1), [
    'POST /api/devices/d1/approve {"code":"654321"}',
    'GET /api/devices '
  ])
  assert.equal(store.pending.length, 0)
  assert.equal(store.trusted.length, 1)
})

test('a failed answer still refreshes the list and passes the error on', async () => {
  let gets = 0
  globalThis.fetch = async (_path, init) => {
    if (init?.method === 'POST') {
      return Response.json({ message: 'expired' }, { status: 410 })
    }
    gets++
    return Response.json([])
  }
  const store = useDevicesStore()
  await assert.rejects(() => store.approve(DEVICE, '123456'), /expired/)
  assert.equal(gets, 1)
  assert.deepEqual(store.devices, [])
})

test('revoke and rename call their routes', async () => {
  const calls: string[] = []
  globalThis.fetch = async (path, init) => {
    calls.push(`${init?.method ?? 'GET'} ${text(path)}`)
    return init?.method === 'DELETE'
      ? new Response(null, { status: 204 })
      : Response.json(init?.method === 'PATCH' ? DEVICE : [])
  }
  const store = useDevicesStore()
  await store.revoke('d1')
  await store.rename('d1', 'New')
  assert.deepEqual(calls, [
    'DELETE /api/devices/d1',
    'GET /api/devices',
    'PATCH /api/devices/d1',
    'GET /api/devices'
  ])
})
