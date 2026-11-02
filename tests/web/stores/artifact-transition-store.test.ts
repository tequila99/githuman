import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import type { ArtifactTransitionOperation } from '@/api/types'
import { useArtifactTransitionStore } from '@/stores/artifact-transition-store'
import { setStorageBackend } from '@/utils/safe-storage'

const ARTIFACT = '00000000-0000-4000-8000-000000000001'

function operation(
  stage: ArtifactTransitionOperation['stage']
): ArtifactTransitionOperation {
  return {
    storeId: 'store',
    id: '00000000-0000-4000-8000-000000000002',
    artifactId: ARTIFACT,
    title: 'Doc',
    fromStatus: 'draft',
    targetStatus: 'accepted',
    presetId: 'p1',
    stage,
    changes: [],
    canCancel: stage === 'validating',
    cancelRequested: false,
    reason: null,
    proposalId: null,
    proposalVersion: null,
    validationId: null,
    verdict: null,
    reportArtifactId: null,
    createdAt: 1,
    updatedAt: Date.now(),
    consentExpiresAt: 2
  }
}
function requestIdOf(init?: RequestInit): string {
  return typeof init?.body === 'string' ? JSON.parse(init.body).requestId : ''
}
function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') {
    return input
  }
  return input instanceof URL ? input.href : input.url
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}

let savedFetch: typeof fetch
let memory: Map<string, string>
beforeEach(() => {
  savedFetch = globalThis.fetch
  setActivePinia(createPinia())
  memory = new Map()
  setStorageBackend({
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => void memory.set(key, value),
    removeItem: key => void memory.delete(key)
  })
})
afterEach(() => {
  globalThis.fetch = savedFetch
  setStorageBackend(null)
})

test('load shows menu data and the latest operation, and dismiss hides a finished one', async () => {
  globalThis.fetch = async input => {
    const url = urlOf(input)
    return url.endsWith('/transitions')
      ? json({
          storeId: 'store',
          artifactId: ARTIFACT,
          status: 'draft',
          targets: [{ status: 'accepted', available: true, reason: null }],
          activeOperationId: null
        })
      : json({ storeId: 'store', items: [operation('failed')] })
  }
  const store = useArtifactTransitionStore()
  await store.load(ARTIFACT)
  assert.equal(store.entry(ARTIFACT).options?.targets.length, 1)
  assert.equal(store.entry(ARTIFACT).operation?.stage, 'failed')
  store.dismiss(ARTIFACT)
  assert.equal(store.entry(ARTIFACT).operation, null)
  await store.load(ARTIFACT)
  assert.equal(store.entry(ARTIFACT).operation, null)
})

test('a lost answer is retried with the same request ID and the preset is remembered after success', async () => {
  const ids: string[] = []
  let calls = 0
  globalThis.fetch = async (input, init) => {
    // Reads that follow a start are not under test.
    if (init?.method !== 'POST') {
      return urlOf(input).endsWith('/transitions')
        ? json(options())
        : json({ storeId: 'store', items: [] })
    }
    ids.push(requestIdOf(init))
    calls++
    return calls === 1
      ? Promise.reject(new TypeError('network'))
      : json(operation('validating'))
  }
  const store = useArtifactTransitionStore()
  await assert.rejects(() => store.begin(ARTIFACT, 'preview', 'p1'))
  assert.equal(store.lastPreset(), null)
  await store.begin(ARTIFACT, 'preview', 'p1')
  assert.equal(ids[0], ids[1])
  assert.equal(store.lastPreset(), 'p1')
  assert.equal(store.entry(ARTIFACT).operation?.stage, 'validating')
})

test('a changed preset after a lost answer uses a new request ID', async () => {
  const ids: string[] = []
  globalThis.fetch = async (_input, init) => {
    if (init?.method !== 'POST') {
      return Promise.reject(new TypeError('network'))
    }
    ids.push(requestIdOf(init))
    return Promise.reject(new TypeError('network'))
  }
  const store = useArtifactTransitionStore()
  await assert.rejects(() => store.begin(ARTIFACT, 'preview', 'p1'))
  await assert.rejects(() => store.begin(ARTIFACT, 'preview', 'p2'))
  assert.notEqual(ids[0], ids[1])
})

function options(activeOperationId: string | null = null) {
  return {
    storeId: 'store',
    artifactId: ARTIFACT,
    status: 'draft',
    targets: [{ status: 'accepted', available: true, reason: null }],
    activeOperationId
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

test('a read that started before begin cannot hide the new operation', async () => {
  const late = deferred<Response>()
  let reads = 0
  globalThis.fetch = async (input, init) => {
    const url = urlOf(input)
    if (init?.method === 'POST') {
      return json(operation('validating'))
    }
    reads++
    if (reads <= 2) {
      // The first pair of reads waits and answers with the old state.
      await late.promise
      return url.endsWith('/transitions')
        ? json(options())
        : json({ storeId: 'store', items: [] })
    }
    return url.endsWith('/transitions')
      ? json(options('00000000-0000-4000-8000-000000000002'))
      : json({ storeId: 'store', items: [operation('validating')] })
  }
  const store = useArtifactTransitionStore()
  const first = store.load(ARTIFACT)
  await store.begin(ARTIFACT, 'preview', 'p1')
  late.resolve(new Response('{}'))
  await first
  // Checked before the queued reread finishes: only the guard keeps the operation.
  assert.equal(store.entry(ARTIFACT).operation?.stage, 'validating')
  assert.notEqual(store.entry(ARTIFACT).options?.activeOperationId, null)
})

test('begin blocks a second start at once and a refused start rereads the state', async () => {
  let reads = 0
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'POST') {
      return json({ message: 'busy' }, 409)
    }
    reads++
    return urlOf(input).endsWith('/transitions')
      ? json(options())
      : json({ storeId: 'store', items: [] })
  }
  const store = useArtifactTransitionStore()
  await assert.rejects(() => store.begin(ARTIFACT, 'preview', 'p1'))
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(reads >= 2)
  assert.equal(store.entry(ARTIFACT).options?.activeOperationId, null)
})

test('a failed read shows an error, keeps old options as stale and a retry clears it', async () => {
  let fail = false
  globalThis.fetch = async input => {
    if (fail) {
      return Promise.reject(new TypeError('network'))
    }
    return urlOf(input).endsWith('/transitions')
      ? json(options())
      : json({ storeId: 'store', items: [] })
  }
  const store = useArtifactTransitionStore()
  await store.load(ARTIFACT)
  fail = true
  await store.load(ARTIFACT)
  assert.notEqual(store.entry(ARTIFACT).error, null)
  assert.equal(store.entry(ARTIFACT).stale, true)
  assert.notEqual(store.entry(ARTIFACT).options, null)
  fail = false
  await store.load(ARTIFACT)
  assert.equal(store.entry(ARTIFACT).error, null)
  assert.equal(store.entry(ARTIFACT).stale, false)
})

test('an old finished operation is not shown after a reload, a running one always is', async t => {
  const now = 10_000_000
  t.mock.method(Date, 'now', () => now)
  let current: ArtifactTransitionOperation = {
    ...operation('failed'),
    updatedAt: now - 11 * 60_000
  }
  globalThis.fetch = async input =>
    urlOf(input).endsWith('/transitions')
      ? json(options())
      : json({ storeId: 'store', items: [current] })
  const store = useArtifactTransitionStore()
  await store.load(ARTIFACT)
  assert.equal(store.entry(ARTIFACT).operation, null)
  current = { ...current, updatedAt: now - 60_000 }
  await store.load(ARTIFACT)
  assert.equal(store.entry(ARTIFACT).operation?.stage, 'failed')
  current = { ...operation('validating'), updatedAt: now - 60 * 60_000 }
  await store.load(ARTIFACT)
  assert.equal(store.entry(ARTIFACT).operation?.stage, 'validating')
})

test('release clears the artifact state of reads', async () => {
  globalThis.fetch = async input =>
    urlOf(input).endsWith('/transitions')
      ? json(options())
      : json({ storeId: 'store', items: [] })
  const store = useArtifactTransitionStore()
  await store.load(ARTIFACT)
  store.release(ARTIFACT)
  await store.load(ARTIFACT)
  assert.notEqual(store.entry(ARTIFACT).options, null)
})
