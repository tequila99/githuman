import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setActivePinia, createPinia } from 'pinia'
import { useAppInfoStore } from '@/stores/app-info-store'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  })
}

let originalFetch: typeof fetch

beforeEach(() => {
  setActivePinia(createPinia())
  originalFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('fetchInfo populates version from the API', async () => {
  globalThis.fetch = async () => jsonResponse({ version: '1.2.3' })

  const store = useAppInfoStore()
  await store.fetchInfo()

  assert.equal(store.version, '1.2.3')
  assert.equal(store.loading, false)
  assert.equal(store.error, null)
})

test('fetchInfo leaves version null and records the error on failure', async () => {
  globalThis.fetch = async () => new Response('nope', { status: 500 })

  const store = useAppInfoStore()
  await store.fetchInfo()

  assert.equal(store.version, null)
  assert.notEqual(store.error, null)
  assert.equal(store.loading, false)
})
