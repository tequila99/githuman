import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createArtifactDetailPage } from '@/utils/artifact-detail-page'

type Page = { storeId: string; items: string[]; next: string | null }
function page(item = 'first', next: string | null = null): Page {
  return { storeId: 'store', items: [item], next }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
function resource(fetch: (cursor: string | null) => Promise<Page>) {
  return createArtifactDetailPage({
    storeId: 'store',
    fetch,
    cursor: (value: Page) => value.next,
    validate: () => {},
    append: (a: Page, b: Page) => ({ ...b, items: [...a.items, ...b.items] })
  })
}

test('closed panels make no requests, retain a clean cache and refresh invalidated data on reopening', async () => {
  let calls = 0
  const detail = resource(async () => {
    calls++
    return page(String(calls))
  })
  await detail.refresh()
  await detail.invalidate()
  assert.equal(calls, 0)
  await detail.setActive(true)
  assert.equal(calls, 1)
  await detail.setActive(false)
  await detail.setActive(true)
  assert.equal(calls, 1)
  await detail.setActive(false)
  await detail.invalidate()
  assert.equal(calls, 1)
  await detail.setActive(true)
  assert.equal(calls, 2)
  assert.equal(detail.state.page?.items[0], '2')
})

test('invalidation during refresh queues a fresh read and ignores the pre-event response', async () => {
  let calls = 0
  const first = deferred<Page>()
  const detail = resource(async () => {
    calls++
    return calls === 1 ? first.promise : page('fresh')
  })
  const opening = detail.setActive(true)
  const updating = detail.invalidate()
  assert.equal(calls, 1)
  first.resolve(page('old'))
  await Promise.all([opening, updating])
  assert.equal(calls, 2)
  assert.equal(detail.state.page?.items[0], 'fresh')
  assert.equal(detail.state.stale, false)
})

test('refresh failure keeps old data visibly stale and blocks pagination', async () => {
  let calls = 0
  const detail = resource(async () => {
    calls++
    if (calls > 1) throw new Error('offline')
    return page('first', 'next')
  })
  await detail.setActive(true)
  await detail.invalidate()
  assert.equal(detail.state.page?.items.length, 1)
  assert.equal(detail.state.error, 'offline')
  assert.equal(detail.state.stale, true)
  await detail.more()
  assert.equal(calls, 2)
})

test('a refresh during pagination cannot append the old page to a fresh result', async () => {
  const pending = deferred<Page>()
  let reads = 0
  const detail = resource(async cursor => {
    if (cursor) return pending.promise
    reads++
    return page(reads === 1 ? 'old' : 'fresh', 'next')
  })
  await detail.setActive(true)
  const loading = detail.more()
  await detail.invalidate()
  pending.resolve(page('old more'))
  await loading
  assert.deepEqual(detail.state.page?.items, ['fresh'])
})

test('another store cannot replace existing details', async () => {
  const detail = resource(async () => ({ ...page(), storeId: 'other' }))
  await detail.setActive(true)
  assert.equal(detail.state.page, null)
  assert.match(detail.state.error ?? '', /another artifact store/)
})

test('hiding during a request discards its response and reopening queues a new read', async () => {
  const pending = deferred<Page>()
  let calls = 0
  const detail = resource(async () => {
    calls++
    return calls === 1 ? pending.promise : page('visible')
  })
  const first = detail.setActive(true)
  await detail.setActive(false)
  const second = detail.setActive(true)
  pending.resolve(page('hidden'))
  await Promise.all([first, second])
  assert.equal(calls, 2)
  assert.equal(detail.state.page?.items[0], 'visible')
})

test('disposing suppresses late responses and queued catch-up', async () => {
  const pending = deferred<Page>()
  let calls = 0
  const detail = resource(async () => {
    calls++
    return pending.promise
  })
  const first = detail.setActive(true)
  const second = detail.invalidate()
  detail.dispose()
  pending.resolve(page('late'))
  await Promise.all([first, second])
  await detail.setActive(true)
  assert.equal(calls, 1)
  assert.equal(detail.state.page, null)
  assert.equal(detail.state.loading, false)
})

test('hiding aborts the HTTP read without surfacing an error, and reopening can continue', async () => {
  const signals: AbortSignal[] = []
  const detail = createArtifactDetailPage<Page, string>({
    storeId: 'store',
    fetch: (_cursor, signal) => {
      signals.push(signal)
      if (signals.length > 1) return Promise.resolve(page('reopened'))
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true
        })
      })
    },
    cursor: value => value.next,
    validate: () => {},
    append: (_previous, next) => next
  })
  const first = detail.setActive(true)
  await detail.setActive(false)
  await first
  assert.equal(signals[0]?.aborted, true)
  assert.equal(detail.state.error, null)
  await detail.setActive(true)
  assert.equal(detail.state.page?.items[0], 'reopened')
})
