import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setActivePinia, createPinia } from 'pinia'
import { useReviewDetailStore } from '@/stores/review-detail-store'
import type { DiffFile, Review, ReviewSummary } from '@/api/types'

const file: DiffFile = {
  oldPath: 'a.txt',
  newPath: 'a.txt',
  status: 'modified',
  additions: 1,
  deletions: 0,
  isBinary: false,
  hunks: []
}

const summary: ReviewSummary = {
  id: 'r1',
  repositoryPath: '/repo',
  baseRef: null,
  sourceType: 'local',
  sourceRef: null,
  status: 'in_progress',
  name: 'n',
  branch: 'main',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
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

test('a status change keeps the file objects and holds no snapshot (#57)', async () => {
  const full: Review = { ...summary, snapshotData: JSON.stringify([file]) }
  globalThis.fetch = async (input, init) => {
    // The API client always passes a string path.
    const url = input as string
    if (init?.method === 'PATCH') {
      return jsonResponse({ ...summary, status: 'approved' })
    }
    return jsonResponse(url.endsWith('/comments') ? [] : full)
  }
  const store = useReviewDetailStore()
  await store.load('r1')
  const filesBefore = store.files
  assert.equal(filesBefore.length, 1)

  await store.setStatus('approved')

  assert.equal(store.review?.status, 'approved')
  assert.equal(store.files, filesBefore, 'the same array, so cards keep state')
  assert.equal('snapshotData' in store.review, false)
})

test('a late status answer does not replace a review loaded after it (#57)', async () => {
  const other: Review = {
    ...summary,
    id: 'r2',
    snapshotData: JSON.stringify([
      { ...file, newPath: 'b.txt', oldPath: 'b.txt' }
    ])
  }
  let answerPatch!: (response: Response) => void
  globalThis.fetch = async (input, init) => {
    // The API client always passes a string path.
    const url = input as string
    if (init?.method === 'PATCH') {
      return new Promise<Response>(resolve => {
        answerPatch = resolve
      })
    }
    if (url.endsWith('/comments')) return jsonResponse([])
    return jsonResponse(
      url.endsWith('/r2')
        ? other
        : { ...summary, snapshotData: JSON.stringify([file]) }
    )
  }
  const store = useReviewDetailStore()
  await store.load('r1')

  const patching = store.setStatus('approved')
  await store.load('r2')
  answerPatch(jsonResponse({ ...summary, status: 'approved' }))
  await patching

  assert.equal(store.review?.id, 'r2')
  assert.equal(store.files[0]?.newPath, 'b.txt')
})

test('a failed load clears the files of the previous review', async () => {
  globalThis.fetch = async input =>
    // The API client always passes a string path.
    (input as string).endsWith('/comments')
      ? jsonResponse([])
      : jsonResponse({ ...summary, snapshotData: JSON.stringify([file]) })
  const store = useReviewDetailStore()
  await store.load('r1')
  assert.equal(store.files.length, 1)

  globalThis.fetch = async () => new Response('nope', { status: 500 })
  await store.load('r1')

  assert.equal(store.review, null)
  assert.deepEqual(store.files, [])
})
