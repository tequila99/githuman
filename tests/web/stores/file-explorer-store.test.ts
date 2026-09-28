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

test('overlapping refresh() calls share a single in-flight fetch', async () => {
  // fetchDiff() fires two concurrent requests (staged + unstaged) per call, so
  // each invocation needs its own resolver, not one shared across both.
  const pendingResolvers: Array<(r: Response) => void> = []
  const fetchSpy = mock.fn(
    () =>
      new Promise<Response>(resolve => {
        pendingResolvers.push(resolve)
      })
  )
  globalThis.fetch = fetchSpy

  const explorer = useFileExplorerStore()
  const first = explorer.refresh()
  const second = explorer.refresh() // fires while `first` is still pending

  for (const resolve of pendingResolvers) resolve(jsonResponse([]))
  await Promise.all([first, second])

  // Only the first call's fetchDiff actually ran (2 requests: staged + unstaged);
  // the second awaited the same in-flight refresh instead of starting a new one.
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
