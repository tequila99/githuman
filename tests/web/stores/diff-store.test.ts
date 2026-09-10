import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setActivePinia, createPinia } from 'pinia'
import { useDiffStore } from '@/stores/diff-store'
import type { DiffFile } from '@/api/types'

function file(overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    oldPath: 'a.txt',
    newPath: 'a.txt',
    status: 'modified',
    additions: 1,
    deletions: 0,
    isBinary: false,
    hunks: [],
    ...overrides
  }
}

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

test('fetchDiff populates staged/unstaged from the API', async () => {
  const staged = [file({ newPath: 's.txt' })]
  const unstaged = [file({ newPath: 'u.txt' })]
  globalThis.fetch = (async (input: string | URL) => {
    const url = input.toString()
    if (url.includes('/staged')) return jsonResponse(staged)
    if (url.includes('/unstaged')) return jsonResponse(unstaged)
    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof fetch

  const store = useDiffStore()
  await store.fetchDiff()

  assert.deepEqual(store.stagedFiles, staged)
  assert.deepEqual(store.unstagedFiles, unstaged)
  assert.equal(store.loading, false)
  assert.equal(store.error, null)
})

test('fetchDiff clears both lists and records the error on failure', async () => {
  globalThis.fetch = async () => new Response('nope', { status: 500 })

  const store = useDiffStore()
  // Seed non-empty state first, so we can tell fetchDiff actually cleared it
  // rather than just starting empty.
  store.stagedFiles = [file()]
  store.unstagedFiles = [file()]

  await store.fetchDiff()

  assert.deepEqual(store.stagedFiles, [])
  assert.deepEqual(store.unstagedFiles, [])
  assert.equal(store.loading, false)
  assert.ok(store.error)
})

test('fetchDiff reuses object identity for files unchanged since the last fetch', async () => {
  // reconcileFiles (diff-store.ts) is what keeps per-card UI state (e.g. the
  // "show full file" toggle in DiffFileCard) from resetting on every
  // SSE-triggered refetch — see ADR 0014. A regression here is silent: the
  // app still "works", it just loses UI state on every poll.
  const unchanged = file({ newPath: 'unchanged.txt', additions: 3 })
  const before = [unchanged, file({ newPath: 'changed.txt', additions: 1 })]
  const after = [
    { ...unchanged }, // same content, different object
    file({ newPath: 'changed.txt', additions: 2 }) // genuinely changed
  ]

  let call = 0
  globalThis.fetch = (async (input: string | URL) => {
    const url = input.toString()
    if (url.includes('/unstaged')) return jsonResponse([])
    call += 1
    return jsonResponse(call === 1 ? before : after)
  }) as typeof fetch

  const store = useDiffStore()
  await store.fetchDiff()
  const firstUnchanged = store.stagedFiles.find(
    f => f.newPath === 'unchanged.txt'
  )
  const firstChanged = store.stagedFiles.find(f => f.newPath === 'changed.txt')

  await store.fetchDiff()
  const secondUnchanged = store.stagedFiles.find(
    f => f.newPath === 'unchanged.txt'
  )
  const secondChanged = store.stagedFiles.find(f => f.newPath === 'changed.txt')

  assert.equal(
    secondUnchanged,
    firstUnchanged,
    'unchanged file must keep its object identity'
  )
  assert.notEqual(
    secondChanged,
    firstChanged,
    'changed file must get a new object'
  )
  assert.equal(secondChanged?.additions, 2)
})

test('changedPaths combines staged and unstaged paths', async () => {
  globalThis.fetch = (async (input: string | URL) => {
    const url = input.toString()
    if (url.includes('/staged'))
      return jsonResponse([file({ newPath: 's.txt' })])
    return jsonResponse([file({ newPath: 'u.txt' })])
  }) as typeof fetch

  const store = useDiffStore()
  await store.fetchDiff()

  assert.deepEqual(new Set(store.changedPaths), new Set(['s.txt', 'u.txt']))
})
