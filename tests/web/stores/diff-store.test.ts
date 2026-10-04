import { test, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { setActivePinia, createPinia } from 'pinia'
import { effectScope, nextTick } from 'vue'
import { useDiffStore } from '@/stores/diff-store'
import { useHunksOnDemand } from '@/composables/use-hunks-on-demand'
import type { DiffFile, DiffFileSummary } from '@/api/types'

// A list entry as the server sends it: no hunks, but a signature (ADR 0033).
function file(
  overrides: Partial<DiffFileSummary> = {}
): DiffFileSummary & DiffFile {
  const base: DiffFileSummary = {
    oldPath: 'a.txt',
    newPath: 'a.txt',
    status: 'modified',
    additions: 1,
    deletions: 0,
    isBinary: false,
    signature: 'sig',
    ...overrides
  }
  return { ...base, hunks: [] }
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

  assert.deepEqual(
    store.stagedFiles.map(f => f.newPath),
    ['s.txt']
  )
  assert.deepEqual(
    store.unstagedFiles.map(f => f.newPath),
    ['u.txt']
  )
  assert.deepEqual(store.stagedFiles[0]!.hunks, [])
  assert.equal(store.loading, false)
  assert.equal(store.error, null)
})

test('a failed first fetchDiff clears both lists and records the error', async () => {
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

test('a failed refetch keeps the last good lists and records the error', async () => {
  // Clearing them would unmount the sidebar list and reset its scroll
  // position on any transient error during an SSE refresh (#26).
  const staged = [file({ newPath: 's.txt' })]
  const unstaged = [file({ newPath: 'u.txt' })]
  globalThis.fetch = (async (input: string | URL) =>
    jsonResponse(
      input.toString().includes('/unstaged') ? unstaged : staged
    )) as typeof fetch

  const store = useDiffStore()
  await store.fetchDiff()

  globalThis.fetch = async () => new Response('nope', { status: 500 })
  await store.fetchDiff()

  assert.deepEqual(
    store.stagedFiles.map(f => f.newPath),
    ['s.txt']
  )
  assert.deepEqual(
    store.unstagedFiles.map(f => f.newPath),
    ['u.txt']
  )
  assert.ok(store.error)
})

test('fetchDiff reuses object identity for files unchanged since the last fetch', async () => {
  // reconcileFiles (diff-store.ts) is what keeps per-card UI state (e.g. the
  // "show full file" toggle in DiffFileCard) from resetting on every
  // SSE-triggered refetch — see ADR 0014. A regression here is silent: the
  // app still "works", it just loses UI state on every poll.
  const unchanged = file({ newPath: 'unchanged.txt', additions: 3 })
  const before = [
    unchanged,
    file({ newPath: 'changed.txt', additions: 1, signature: 's1' })
  ]
  const after = [
    { ...unchanged }, // same signature, different object
    file({ newPath: 'changed.txt', additions: 2, signature: 's2' }) // genuinely changed
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

test('initialLoading is true only during the first fetch, not on refetches', async () => {
  // A refetch must not flip the file list back to a spinner — that unmounts
  // the list and resets its scroll position (#26).
  const pendingResolvers: Array<(r: Response) => void> = []
  globalThis.fetch = () =>
    new Promise<Response>(resolve => {
      pendingResolvers.push(resolve)
    })
  const resolveAll = () => {
    for (const resolve of pendingResolvers.splice(0)) resolve(jsonResponse([]))
  }

  const store = useDiffStore()
  assert.equal(store.initialLoading, false)

  const first = store.fetchDiff()
  assert.equal(store.initialLoading, true)
  resolveAll()
  await first
  assert.equal(store.initialLoading, false)

  const second = store.fetchDiff()
  assert.equal(store.loading, true)
  assert.equal(store.initialLoading, false)
  resolveAll()
  await second
})

test('initialLoading clears after a failed first fetch', async () => {
  globalThis.fetch = async () => new Response('nope', { status: 500 })

  const store = useDiffStore()
  await store.fetchDiff()

  assert.equal(store.initialLoading, false)
  assert.ok(store.error)
})

test('a fetchDiff call made mid-fetch gets exactly one more request pair after it (#37)', async () => {
  const pendingResolvers: Array<(r: Response) => void> = []
  const fetchSpy = mock.fn(
    () =>
      new Promise<Response>(resolve => {
        pendingResolvers.push(resolve)
      })
  )
  globalThis.fetch = fetchSpy
  const resolvePending = () => {
    for (const resolve of pendingResolvers.splice(0)) resolve(jsonResponse([]))
  }

  const store = useDiffStore()
  const first = store.fetchDiff()
  const second = store.fetchDiff()
  const third = store.fetchDiff()
  assert.equal(fetchSpy.mock.callCount(), 2, 'no parallel request pairs')

  resolvePending()
  await first
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fetchSpy.mock.callCount(), 4, 'one follow-up pair for both')

  resolvePending()
  await Promise.all([second, third])
  assert.equal(fetchSpy.mock.callCount(), 4)
})

test('error survives a retry in flight and clears only once a fetch succeeds (#35)', async () => {
  globalThis.fetch = async () => new Response('nope', { status: 500 })
  const store = useDiffStore()
  await store.fetchDiff()
  assert.ok(store.error)

  const pendingResolvers: Array<(r: Response) => void> = []
  globalThis.fetch = () =>
    new Promise<Response>(resolve => {
      pendingResolvers.push(resolve)
    })
  const retry = store.fetchDiff()
  assert.ok(store.error, 'no blink while the retry is in flight')

  assert.equal(pendingResolvers.length, 2, 'both diff requests are in flight')
  for (const resolve of pendingResolvers.splice(0)) {
    resolve(jsonResponse([file({ newPath: 'back.txt' })]))
  }
  await retry

  assert.equal(store.error, null)
  assert.equal(store.stagedFiles.length, 1)
})

function routeDiffApi(options: {
  list: () => DiffFileSummary[]
  detail?: (url: string) => Response | Promise<Response>
}) {
  const seen: string[] = []
  globalThis.fetch = (async (input: string | URL) => {
    const url = input.toString()
    seen.push(url)
    if (url.includes('/unstaged/files')) return jsonResponse([])
    if (url.includes('/staged/files')) return jsonResponse(options.list())
    if (url.includes('/file?')) {
      return options.detail?.(url) ?? jsonResponse(file())
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof fetch
  return seen
}

test('ensureHunks loads the hunks of one file and marks them fresh', async () => {
  const seen = routeDiffApi({
    list: () => [file({ newPath: 'a.txt', signature: 'v1' })],
    detail: () =>
      jsonResponse({
        ...file({ newPath: 'a.txt' }),
        hunks: [
          { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [] }
        ]
      })
  })
  const store = useDiffStore()
  await store.fetchDiff()
  const entry = store.stagedFiles[0]!

  assert.equal(store.hunksFresh('staged', entry), false)
  await store.ensureHunks('staged', entry)

  assert.equal(store.hunksFresh('staged', entry), true)
  assert.equal(store.hunksOf('staged', entry)?.hunks.length, 1)
  assert.ok(seen.some(url => url.includes('/api/diff/staged/file?path=a.txt')))
})

test('ensureHunks does not fetch fresh hunks again', async () => {
  const seen = routeDiffApi({ list: () => [file({ newPath: 'a.txt' })] })
  const store = useDiffStore()
  await store.fetchDiff()
  const entry = store.stagedFiles[0]!

  await store.ensureHunks('staged', entry)
  await store.ensureHunks('staged', entry)

  assert.equal(seen.filter(url => url.includes('/file?')).length, 1)
})

test('a changed signature makes old hunks stale but keeps them until the new ones arrive', async () => {
  let signature = 'v1'
  routeDiffApi({ list: () => [file({ newPath: 'a.txt', signature })] })
  const store = useDiffStore()
  await store.fetchDiff()
  await store.ensureHunks('staged', store.stagedFiles[0]!)
  const oldHunks = store.hunksOf('staged', store.stagedFiles[0]!)

  signature = 'v2'
  await store.fetchDiff()
  const entry = store.stagedFiles[0]!

  assert.equal(store.hunksFresh('staged', entry), false)
  assert.equal(store.hunksOf('staged', entry), oldHunks)
})

test('hunks of a file that left the list are dropped', async () => {
  let present = true
  routeDiffApi({ list: () => (present ? [file({ newPath: 'a.txt' })] : []) })
  const store = useDiffStore()
  await store.fetchDiff()
  const entry = store.stagedFiles[0]!
  await store.ensureHunks('staged', entry)

  present = false
  await store.fetchDiff()

  assert.equal(store.hunksOf('staged', entry), undefined)
})

test('a failed hunks request records an error and does not mark the hunks fresh', async () => {
  routeDiffApi({
    list: () => [file({ newPath: 'a.txt' })],
    detail: () => new Response('nope', { status: 500 })
  })
  const store = useDiffStore()
  await store.fetchDiff()
  const entry = store.stagedFiles[0]!

  await store.ensureHunks('staged', entry)

  assert.ok(store.hunksError('staged', entry))
  assert.equal(store.hunksFresh('staged', entry), false)
})

test('an error belongs to its list entry: a new version of the file has no error', async () => {
  let signature = 'v1'
  routeDiffApi({
    list: () => [file({ newPath: 'a.txt', signature })],
    detail: () => new Response('nope', { status: 500 })
  })
  const store = useDiffStore()
  await store.fetchDiff()
  await store.ensureHunks('staged', store.stagedFiles[0]!)
  assert.ok(store.hunksError('staged', store.stagedFiles[0]!))

  signature = 'v2'
  await store.fetchDiff()

  assert.equal(store.hunksError('staged', store.stagedFiles[0]!), undefined)
})

test('the error of a request for a gone list entry is not recorded', async () => {
  let signature = 'v1'
  let fail: (() => void) | undefined
  routeDiffApi({
    list: () => [file({ newPath: 'a.txt', signature })],
    detail: () =>
      new Promise<Response>(resolve => {
        fail = () => resolve(new Response('nope', { status: 500 }))
      })
  })
  const store = useDiffStore()
  await store.fetchDiff()
  const request = store.ensureHunks('staged', store.stagedFiles[0]!)

  signature = 'v2'
  await store.fetchDiff()
  fail?.()
  await request

  assert.equal(store.hunksError('staged', store.stagedFiles[0]!), undefined)
})

test('clearHunksError lets the same list entry ask again, and retryHunks asks', async () => {
  let ok = false
  const seen = routeDiffApi({
    list: () => [file({ newPath: 'a.txt' })],
    detail: () =>
      ok
        ? jsonResponse({ ...file({ newPath: 'a.txt' }), hunks: [] })
        : new Response('nope', { status: 500 })
  })
  const store = useDiffStore()
  await store.fetchDiff()
  const entry = store.stagedFiles[0]!
  await store.ensureHunks('staged', entry)
  assert.ok(store.hunksError('staged', entry))

  store.clearHunksError('staged', entry)
  assert.equal(store.hunksError('staged', entry), undefined)

  await store.ensureHunks('staged', entry)
  assert.ok(store.hunksError('staged', entry))
  ok = true
  await store.retryHunks('staged', entry)

  assert.equal(store.hunksError('staged', entry), undefined)
  assert.equal(store.hunksFresh('staged', entry), true)
  assert.equal(seen.filter(url => url.includes('/file?')).length, 3)
})

test('errors of files that left the list are dropped', async () => {
  let present = true
  routeDiffApi({
    list: () => (present ? [file({ newPath: 'a.txt' })] : []),
    detail: () => new Response('nope', { status: 500 })
  })
  const store = useDiffStore()
  await store.fetchDiff()
  const entry = store.stagedFiles[0]!
  await store.ensureHunks('staged', entry)

  present = false
  await store.fetchDiff()
  present = true
  await store.fetchDiff()

  // Same signature, so the list may give back an equal entry: it must have no old error.
  assert.equal(store.hunksError('staged', store.stagedFiles[0]!), undefined)
  assert.equal(store.hunksError('staged', entry), undefined)
})

test('a list update while the hunks request is on the way asks for the new version (store and composable)', async () => {
  let signature = 'v1'
  const answers: (() => void)[] = []
  const seen = routeDiffApi({
    list: () => [file({ newPath: 'a.txt', signature })],
    detail: () =>
      new Promise<Response>(resolve => {
        answers.push(() =>
          resolve(
            jsonResponse({
              ...file({ newPath: 'a.txt' }),
              hunks: [
                {
                  oldStart: 1,
                  oldLines: 1,
                  newStart: 1,
                  newLines: 1,
                  lines: []
                }
              ]
            })
          )
        )
      })
  })
  const store = useDiffStore()
  await store.fetchDiff()

  const scope = effectScope()
  const { bodyMounted } = scope.run(() =>
    useHunksOnDemand({
      expanded: true,
      loaded: () => store.hunksFresh('staged', store.stagedFiles[0]!),
      error: () => store.hunksError('staged', store.stagedFiles[0]!),
      version: () => store.stagedFiles[0],
      onNeeded: () => void store.ensureHunks('staged', store.stagedFiles[0]!)
    })
  )!
  bodyMounted.value = true
  await nextTick()
  assert.equal(answers.length, 1)

  signature = 'v2'
  await store.fetchDiff()
  await nextTick()
  answers[0]!()
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.equal(answers.length, 2)
  answers[1]!()
  await new Promise(resolve => setTimeout(resolve, 0))
  const current = store.stagedFiles[0]!
  assert.equal(store.hunksFresh('staged', current), true)
  assert.equal(store.hunksOf('staged', current)?.hunks.length, 1)
  assert.equal(seen.filter(url => url.includes('/file?')).length, 2)
  scope.stop()
})
