import { test, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { setActivePinia, createPinia } from 'pinia'
import { useFileExplorerStore } from '@/stores/file-explorer-store'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

let originalFetch: typeof fetch
let originalNow: () => number
let fakeNow: number

beforeEach(() => {
  setActivePinia(createPinia())
  originalFetch = globalThis.fetch
  globalThis.fetch = async () => jsonResponse([])

  // Deterministic clock: REFRESH_COOLDOWN_MS is measured with Date.now(), and
  // real elapsed time in a test run is too jittery to reliably land on either
  // side of the 400ms window.
  fakeNow = 0
  originalNow = Date.now
  Date.now = () => fakeNow
})

afterEach(() => {
  globalThis.fetch = originalFetch
  Date.now = originalNow
})

test('refresh() always fetches, even right after a previous refresh()', async () => {
  const fetchSpy = mock.fn(globalThis.fetch)
  globalThis.fetch = fetchSpy

  const explorer = useFileExplorerStore()
  await explorer.refresh()
  fakeNow += 100 // well within REFRESH_COOLDOWN_MS
  await explorer.refresh()

  // 2 calls per refresh (staged + unstaged)
  assert.equal(fetchSpy.mock.callCount(), 4)
})

test('refreshFromServerEvent() is skipped shortly after an explicit refresh()', async () => {
  const fetchSpy = mock.fn(globalThis.fetch)
  globalThis.fetch = fetchSpy

  const explorer = useFileExplorerStore()
  await explorer.refresh()
  assert.equal(fetchSpy.mock.callCount(), 2)

  fakeNow += 100 // still within REFRESH_COOLDOWN_MS
  await explorer.refreshFromServerEvent()

  assert.equal(fetchSpy.mock.callCount(), 2, 'should not have fetched again')
})

test('refreshFromServerEvent() fetches once the cooldown window has passed', async () => {
  const fetchSpy = mock.fn(globalThis.fetch)
  globalThis.fetch = fetchSpy

  const explorer = useFileExplorerStore()
  await explorer.refresh()
  assert.equal(fetchSpy.mock.callCount(), 2)

  fakeNow += 500 // past REFRESH_COOLDOWN_MS (400ms)
  await explorer.refreshFromServerEvent()

  assert.equal(fetchSpy.mock.callCount(), 4)
})

// fetchDiff() fires two concurrent requests (staged + unstaged) per run, so
// each needs its own resolver, not one shared across both.
function controlledFetch() {
  const pendingResolvers: Array<(r: Response) => void> = []
  const fetchSpy = mock.fn(
    () =>
      new Promise<Response>(resolve => {
        pendingResolvers.push(resolve)
      })
  )
  globalThis.fetch = fetchSpy
  return {
    fetchSpy,
    resolvePending() {
      for (const resolve of pendingResolvers.splice(0)) {
        resolve(jsonResponse([]))
      }
    }
  }
}

const tick = () => new Promise(resolve => setImmediate(resolve))

test('a refresh() made mid-refresh gets one more fetch after it, not the stale in-flight one (#37)', async () => {
  const { fetchSpy, resolvePending } = controlledFetch()

  const explorer = useFileExplorerStore()
  const first = explorer.refresh()
  let secondDone = false
  const second = explorer.refresh().then(() => (secondDone = true))
  assert.equal(fetchSpy.mock.callCount(), 2, 'no parallel fetches')

  resolvePending()
  await first
  await tick()
  assert.equal(fetchSpy.mock.callCount(), 4)
  assert.equal(secondDone, false, 'waits for the follow-up fetch')

  resolvePending()
  await second
})

test('stage/unstage right after an external edit is not lost in the SSE refetch already running (#37)', async () => {
  const { fetchSpy, resolvePending } = controlledFetch()
  const explorer = useFileExplorerStore()

  fakeNow += 1000 // outside any echo window
  const sseRefetch = explorer.refreshFromServerEvent()
  // The user stages a file while that fetch is still in flight:
  const afterStage = explorer.refresh()

  resolvePending()
  await sseRefetch
  await tick()
  resolvePending()
  await afterStage

  assert.equal(fetchSpy.mock.callCount(), 4)
})

test('the echo of our own refresh() arriving mid-fetch still triggers nothing', async () => {
  const { fetchSpy, resolvePending } = controlledFetch()
  const explorer = useFileExplorerStore()

  const refreshing = explorer.refresh()
  fakeNow += 100 // echo within the window
  await explorer.refreshFromServerEvent()
  resolvePending()
  await refreshing
  await tick()

  assert.equal(fetchSpy.mock.callCount(), 2)
})

test('diffFiles reflects the selected source', async () => {
  globalThis.fetch = (async (input: string | URL) => {
    const url = input.toString()
    if (url.includes('/staged')) {
      return jsonResponse([
        {
          oldPath: 's.txt',
          newPath: 's.txt',
          status: 'modified',
          additions: 1,
          deletions: 0,
          isBinary: false,
          hunks: []
        }
      ])
    }
    return jsonResponse([])
  }) as typeof fetch

  const explorer = useFileExplorerStore()
  await explorer.refresh()

  explorer.source = 'staged'
  assert.equal(explorer.diffFiles.length, 1)

  explorer.source = 'unstaged'
  assert.equal(explorer.diffFiles.length, 0)
})
