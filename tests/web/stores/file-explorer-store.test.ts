import { nextTick } from 'vue'
import { test, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { setActivePinia, createPinia } from 'pinia'
import { useFileExplorerStore } from '@/stores/file-explorer-store'
import { useDiffStore } from '@/stores/diff-store'
import type { DiffFile } from '@/api/types'
import { setStorageBackend } from '@/utils/safe-storage'
import { pathOf } from '@/utils/diff-file'
import { memoryStorage } from '../helpers/memory-storage'

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

// Routes fetch by URL for browse-mode tests: diff, tree and file content.
function routeFetch(routes: {
  tree?: () => Response
  file?: (path: string) => Response | Promise<Response>
}) {
  globalThis.fetch = async input => {
    // The API client always passes a string path.
    const url = input as string
    if (url.startsWith('/api/git/tree/')) {
      return routes.tree?.() ?? jsonResponse({ files: ['a.txt', 'b.txt'] })
    }
    if (url.startsWith('/api/git/file/')) {
      const path = decodeURIComponent(
        url.slice('/api/git/file/'.length).split('?')[0]!
      )
      return (
        routes.file?.(path) ??
        jsonResponse({ lines: [`content of ${path}`], isBinary: false })
      )
    }
    return jsonResponse([])
  }
}

function failure(): Response {
  return new Response(JSON.stringify({ message: 'boom' }), {
    status: 500,
    headers: { 'content-type': 'application/json' }
  })
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0))
}

test('browse: a tree error is exposed and cleared by the next successful refresh (#43)', async () => {
  let treeFails = true
  routeFetch({
    tree: () => (treeFails ? failure() : jsonResponse({ files: ['a.txt'] }))
  })
  const explorer = useFileExplorerStore()
  explorer.browseMode = true
  await explorer.refresh() // joins the refresh entering browse started
  assert.equal(explorer.treeError, 'boom')

  treeFails = false
  await explorer.refresh()
  assert.equal(explorer.treeError, null)
  assert.equal(explorer.totalTreeFiles, 1)
})

test("browse: a failed file's error does not carry over to the next file (#43)", async () => {
  let answerB!: (response: Response) => void
  routeFetch({
    file: path =>
      path === 'a.txt'
        ? failure()
        : new Promise<Response>(resolve => {
            answerB = resolve
          })
  })
  const explorer = useFileExplorerStore()
  explorer.browseMode = true
  await settle()

  explorer.selectFile('a.txt')
  await settle()
  assert.equal(explorer.browseFileError, 'boom')

  explorer.selectFile('b.txt')
  await settle()
  assert.equal(explorer.browseFileError, null, 'b.txt is still loading')

  answerB(jsonResponse({ lines: ['b'], isBinary: false }))
  await settle()
  assert.deepEqual(explorer.browseFileLines, ['b'])
})

test('browse: leaving browse mode forgets the file and its error (#43)', async () => {
  routeFetch({ file: () => failure() })
  const explorer = useFileExplorerStore()
  explorer.browseMode = true
  await settle()
  explorer.selectFile('a.txt')
  await settle()
  assert.equal(explorer.browseFileError, 'boom')

  explorer.browseMode = false
  await settle()
  assert.equal(explorer.browseFileError, null)
  assert.deepEqual(explorer.browseFileLines, [])
})

test('browse: the tree shows a spinner, not "No files", until its first answer (#43)', async () => {
  routeFetch({})
  const explorer = useFileExplorerStore()
  explorer.browseMode = true
  assert.equal(explorer.treeInitialLoading, true, 'still fetching the diff')
  await explorer.refresh()
  assert.equal(explorer.treeInitialLoading, false)
})

test("browse: re-entering doesn't show last session's tree error (#43)", async () => {
  let treeFails = true
  routeFetch({
    tree: () => (treeFails ? failure() : jsonResponse({ files: ['a.txt'] }))
  })
  const explorer = useFileExplorerStore()
  explorer.browseMode = true
  await explorer.refresh()
  assert.equal(explorer.treeError, 'boom')

  explorer.browseMode = false
  await settle()
  assert.equal(explorer.treeError, null)

  treeFails = false
  explorer.browseMode = true
  assert.equal(explorer.treeError, null, 'no stale banner while reloading')
  assert.equal(explorer.treeInitialLoading, true, 'spinner, not the old tree')
  await explorer.refresh()
  assert.equal(explorer.totalTreeFiles, 1)
})

function fileAt(path: string): DiffFile {
  return {
    oldPath: path,
    newPath: path,
    status: 'modified',
    additions: 1,
    deletions: 0,
    isBinary: false,
    hunks: []
  }
}

test('selectFile() asks the panel to scroll by index in the unfiltered list', () => {
  const explorer = useFileExplorerStore()
  useDiffStore().unstagedFiles = ['a.ts', 'b.ts', 'c.ts'].map(fileAt)
  explorer.filter = 'c.ts'

  explorer.selectFile('c.ts')

  assert.deepEqual(explorer.scrollRequest, { path: 'c.ts', index: 2, seq: 1 })
})

test('selectFile() on the same file again makes a new scroll request', () => {
  const explorer = useFileExplorerStore()
  useDiffStore().unstagedFiles = ['a.ts', 'b.ts'].map(fileAt)

  explorer.selectFile('a.ts')
  explorer.selectFile('a.ts')

  assert.equal(explorer.scrollRequest?.seq, 2)
})

test('toggling a card does not ask the panel to scroll', () => {
  const explorer = useFileExplorerStore()
  useDiffStore().unstagedFiles = ['a.ts'].map(fileAt)

  explorer.handleCardToggle('a.ts')

  assert.equal(explorer.scrollRequest, null)
})

test('selectFile() for a path outside the diff makes no scroll request', () => {
  const explorer = useFileExplorerStore()
  useDiffStore().unstagedFiles = ['a.ts'].map(fileAt)

  explorer.selectFile('gone.ts')

  assert.equal(explorer.scrollRequest, null)
})

test('expand all, collapse all and a source change bump the layout version', () => {
  const explorer = useFileExplorerStore()
  const before = explorer.layoutVersion

  explorer.expandAllFiles()
  explorer.collapseAllFiles()

  assert.equal(explorer.layoutVersion, before + 2)
})

test('tree mode orders the cards like the tree and remembers the mode (#76)', async t => {
  const storage = memoryStorage()
  setStorageBackend(storage)
  t.after(() => setStorageBackend(null))
  const explorer = useFileExplorerStore()
  useDiffStore().unstagedFiles = ['README.md', 'src/b.ts', 'src/a/x.ts'].map(
    fileAt
  )
  assert.deepEqual(explorer.diffFiles.map(pathOf), [
    'README.md',
    'src/b.ts',
    'src/a/x.ts'
  ])
  explorer.diffListMode = 'tree'
  await nextTick()
  assert.deepEqual(explorer.diffFiles.map(pathOf), [
    'src/a/x.ts',
    'src/b.ts',
    'README.md'
  ])
  assert.equal(storage.getItem('githuman.diffListMode'), 'tree')

  setActivePinia(createPinia())
  assert.equal(useFileExplorerStore().diffListMode, 'tree')
})

test('a folder row of a compressed chain opens and closes as one (#76)', () => {
  const explorer = useFileExplorerStore()
  useDiffStore().unstagedFiles = ['src/web/a.ts', 'src/web/b.ts'].map(fileAt)
  explorer.diffListMode = 'tree'
  const folder = explorer.diffTreeRows[0]
  assert.ok(folder?.kind === 'folder')
  assert.deepEqual(folder.paths, ['src', 'src/web'])
  explorer.toggleDiffFolder(folder.paths)
  assert.deepEqual(
    explorer.diffTreeRows.map(row => row.path),
    ['src/web']
  )
  // A filter shows every folder open, so no match is hidden.
  explorer.filter = 'b.ts'
  assert.deepEqual(
    explorer.diffTreeRows.map(row => row.path),
    ['src/web', 'src/web/b.ts']
  )
  explorer.filter = ''
  explorer.toggleDiffFolder(folder.paths)
  assert.equal(explorer.diffTreeRows.length, 3)
})

test('a file and a folder with the same path both stay in the tree mode (#76)', () => {
  const explorer = useFileExplorerStore()
  // A deleted folder `foo/` and a new file `foo`: git lists the folder first.
  useDiffStore().unstagedFiles = ['foo/bar.ts', 'foo'].map(fileAt)
  explorer.diffListMode = 'tree'
  assert.deepEqual(explorer.diffFiles.map(pathOf).sort(), ['foo', 'foo/bar.ts'])
  assert.deepEqual(
    explorer.diffTreeRows.map(row => [row.kind, row.path]),
    [
      ['folder', 'foo'],
      ['file', 'foo/bar.ts'],
      ['file', 'foo']
    ]
  )
})

test('a mode switch asks the panel to scroll to the selected card (#76)', async () => {
  const explorer = useFileExplorerStore()
  useDiffStore().unstagedFiles = ['README.md', 'src/a.ts'].map(fileAt)
  explorer.selectFile('README.md')
  const before = explorer.scrollRequest?.seq ?? 0
  explorer.diffListMode = 'tree'
  await nextTick()
  assert.equal(explorer.scrollRequest?.path, 'README.md')
  assert.equal(explorer.scrollRequest?.index, 1)
  assert.equal(explorer.scrollRequest?.seq, before + 1)
})

test('a filter can split a compressed folder; its rows stay open (#76)', () => {
  const explorer = useFileExplorerStore()
  useDiffStore().unstagedFiles = ['src/web/a.ts', 'src/z.ts'].map(fileAt)
  explorer.diffListMode = 'tree'
  assert.deepEqual(
    explorer.diffTreeRows.map(row => row.path),
    ['src', 'src/web', 'src/web/a.ts', 'src/z.ts']
  )
  explorer.toggleDiffFolder(['src'])
  explorer.filter = 'web'
  assert.deepEqual(
    explorer.diffTreeRows.map(row => [row.path, row.name]),
    [
      ['src/web', 'src/web'],
      ['src/web/a.ts', 'a.ts']
    ]
  )
})

test('a file row of the tree carries its own file (#76)', () => {
  const explorer = useFileExplorerStore()
  const files = ['src/a.ts', 'README.md'].map(fileAt)
  useDiffStore().unstagedFiles = files
  explorer.diffListMode = 'tree'
  const fileRows = explorer.diffTreeRows.filter(row => row.kind === 'file')
  assert.deepEqual(
    fileRows.map(row => row.file),
    [files[0], files[1]]
  )
})

test('closed folders reset on a source change and drop out with their folder (#76)', async () => {
  const explorer = useFileExplorerStore()
  const diff = useDiffStore()
  diff.unstagedFiles = ['src/a.ts', 'lib/b.ts'].map(fileAt)
  explorer.diffListMode = 'tree'
  explorer.toggleDiffFolder(['src'])
  explorer.toggleDiffFolder(['lib'])
  await nextTick()

  // `lib` left the diff: it must not come back closed.
  diff.unstagedFiles = ['src/a.ts'].map(fileAt)
  await nextTick()
  assert.deepEqual([...explorer.collapsedDiffFolders], ['src'])

  explorer.source = 'staged'
  await nextTick()
  assert.equal(explorer.collapsedDiffFolders.size, 0)
})
