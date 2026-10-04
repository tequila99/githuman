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
