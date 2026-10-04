import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useDiffStore } from '@/stores/diff-store'
import { useCardStateStore } from '@/stores/card-state-store'
import { cardStateKey } from '@/utils/card-state-key'

beforeEach(() => {
  setActivePinia(createPinia())
})

test('the same path has separate state on Staged and Unstaged', () => {
  const store = useCardStateStore()
  store.set(cardStateKey('staged', 'a.ts'), 'viewMode', 'full')

  assert.equal(store.get(cardStateKey('staged', 'a.ts'), 'viewMode'), 'full')
  assert.equal(
    store.get(cardStateKey('unstaged', 'a.ts'), 'viewMode'),
    undefined
  )
})

test('remove() drops one slot only', () => {
  const store = useCardStateStore()
  store.set('k', 'a', 1)
  store.set('k', 'b', 2)
  store.remove('k', 'a')

  assert.equal(store.get('k', 'a'), undefined)
  assert.equal(store.get('k', 'b'), 2)
})

test('prune() drops state of cards that left the diff', () => {
  const store = useCardStateStore()
  store.set('keep', 'draft', 'text')
  store.set('gone', 'draft', 'text')

  store.prune(new Set(['keep']))

  assert.equal(store.get('keep', 'draft'), 'text')
  assert.equal(store.get('gone', 'draft'), undefined)
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function summary(path: string) {
  return {
    oldPath: path,
    newPath: path,
    status: 'modified',
    additions: 1,
    deletions: 0,
    isBinary: false,
    signature: 'sig'
  }
}

test('the store drops the state of a file that left the diff, without the panel', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  let staged = [summary('a.ts'), summary('b.ts')]
  globalThis.fetch = (async (input: string | URL) =>
    jsonResponse(
      input.toString().includes('/staged/') ? staged : []
    )) as typeof fetch

  const diffStore = useDiffStore()
  await diffStore.fetchDiff()
  const store = useCardStateStore()
  store.set(cardStateKey('staged', 'a.ts'), 'draft', 'keep')
  store.set(cardStateKey('staged', 'b.ts'), 'draft', 'drop')

  staged = [summary('a.ts')]
  await diffStore.fetchDiff()
  await nextTick()

  assert.equal(store.get(cardStateKey('staged', 'a.ts'), 'draft'), 'keep')
  assert.equal(store.get(cardStateKey('staged', 'b.ts'), 'draft'), undefined)
})

test('the store keeps all state before the first good fetch', async () => {
  const store = useCardStateStore()
  store.set(cardStateKey('staged', 'a.ts'), 'draft', 'keep')
  await nextTick()

  assert.equal(store.get(cardStateKey('staged', 'a.ts'), 'draft'), 'keep')
})
