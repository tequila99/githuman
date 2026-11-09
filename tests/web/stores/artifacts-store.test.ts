import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useArtifactsStore } from '@/stores/artifacts-store'
import { artifactRouteState } from '@/utils/artifact-navigation'
import type {
  Artifact,
  ArtifactContent,
  ArtifactSearchResult
} from '@/api/types'

const storeId = '00000000-0000-4000-8000-000000000001'
const id = '00000000-0000-4000-8000-000000000002'
const text = '---\r\ntitle: Original\r\n---\r\n# Текст\r\n'
const metadata: Artifact = {
  storeId,
  id,
  sha256: 'a'.repeat(64),
  bytes: new TextEncoder().encode(text).length,
  bodyStartLine: 4,
  createdAt: '',
  metadataVersion: 1,
  metadataUpdatedAt: '',
  title: 'Current',
  tags: [],
  status: 'draft',
  typeId: 'spec',
  taskIds: [],
  relations: [],
  revisionOf: []
}
function page(title = 'First'): ArtifactSearchResult {
  return {
    storeId,
    storeEpoch: 1,
    indexEpoch: 1,
    nextCursor: null,
    partial: false,
    reason: null,
    items: [
      {
        storeId,
        id,
        title,
        createdAt: metadata.createdAt,
        tags: metadata.tags,
        status: 'draft',
        typeId: 'spec',
        taskIds: [],
        snippet: '',
        source: 'title',
        matchKind: 'catalog',
        highlights: [],
        anchor: null
      }
    ]
  }
}
function chunk(): ArtifactContent {
  return {
    storeId,
    id,
    sha256: metadata.sha256,
    totalBytes: metadata.bytes,
    bodyStartLine: 4,
    offset: 0,
    nextOffset: null,
    text
  }
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
let originalFetch: typeof fetch
beforeEach(() => {
  setActivePinia(createPinia())
  originalFetch = globalThis.fetch
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

test('a new search discards an older response and serializes the follow-up', async () => {
  const first = deferred<Response>()
  const requests: unknown[] = []
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(typeof init?.body === 'string' ? init.body : ''))
    return requests.length === 1 ? first.promise : json(page('New'))
  }
  const store = useArtifactsStore()
  const old = store.search({ query: 'old' })
  const next = store.search({ query: 'new' })
  assert.equal(requests.length, 1)
  first.resolve(json(page('Old')))
  await Promise.all([old, next])
  assert.equal(store.catalog?.items[0]?.title, 'New')
  assert.deepEqual(requests, [{ query: 'old' }, { query: 'new' }])
})

test('failed refresh retains results and marks them stale', async () => {
  globalThis.fetch = async () => json(page())
  const store = useArtifactsStore()
  await store.search({})
  globalThis.fetch = async () => json({ message: 'Unavailable' }, 503)
  await store.refresh()
  assert.equal(store.catalog?.items.length, 1)
  assert.equal(store.error, 'Unavailable')
  assert.equal(store.stale, true)
})

test('pagination rejects another index generation without mixing pages', async () => {
  globalThis.fetch = async () => json({ ...page(), nextCursor: 'next' })
  const store = useArtifactsStore()
  await store.search({})
  globalThis.fetch = async () => json({ ...page('Wrong'), indexEpoch: 2 })
  await store.loadMore()
  assert.equal(store.catalog?.items.length, 1)
  assert.equal(store.catalog?.items[0]?.title, 'First')
  assert.equal(store.stale, true)
})

test('a refresh during pagination prevents a late page from appending', async () => {
  globalThis.fetch = async () => json({ ...page(), nextCursor: 'next' })
  const store = useArtifactsStore()
  await store.search({})
  const pending = deferred<Response>()
  globalThis.fetch = async (_url, init) =>
    JSON.parse(typeof init?.body === 'string' ? init.body : '').cursor
      ? pending.promise
      : json(page('Refreshed'))
  const more = store.loadMore()
  await store.refresh()
  pending.resolve(json(page('Old page')))
  await more
  assert.equal(store.catalog?.items.length, 1)
  assert.equal(store.catalog?.items[0]?.title, 'Refreshed')
})

test('switching a status to All discards an in-flight old page and searches every status without its cursor', async () => {
  const requests: Record<string, unknown>[] = []
  const pending = deferred<Response>()
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(typeof init?.body === 'string' ? init.body : '')
    requests.push(input)
    if (input.cursor) return pending.promise
    return json(
      requests.length === 1
        ? { ...page(), nextCursor: 'old-cursor' }
        : page('All statuses')
    )
  }
  const store = useArtifactsStore()
  await store.search(artifactRouteState({ status: 'draft' }).input)
  const more = store.loadMore()
  await store.search(artifactRouteState({ status: 'all' }).input)
  pending.resolve(json(page('Late draft')))
  await more
  assert.equal(store.catalog?.items.length, 1)
  assert.equal(store.catalog?.items[0]?.title, 'All statuses')
  assert.deepEqual(requests[1]?.filters, { statuses: ['draft'] })
  assert.equal(requests[1]?.cursor, 'old-cursor')
  assert.equal(requests[2]?.cursor, undefined)
  assert.deepEqual(requests[2]?.filters, {
    statuses: [
      'draft',
      'in_review',
      'accepted',
      'rejected',
      'superseded',
      'archived',
      'deleted'
    ]
  })
})

test('content chunks preserve Unicode and CRLF, separate body and current metadata', async () => {
  const prefix = '---\r\ntitle: Original\r\n'
  const offset = new TextEncoder().encode(prefix).length
  globalThis.fetch = async input => {
    const url = typeof input === 'string' ? input : ''
    if (!url.includes('/content')) return json(metadata)
    return json(
      url.endsWith('offset=0')
        ? { ...chunk(), text: prefix, nextOffset: offset }
        : { ...chunk(), offset, text: text.slice(prefix.length) }
    )
  }
  const store = useArtifactsStore()
  await store.select({ storeId, id })
  assert.equal(store.documentError, null)
  assert.equal(store.body, '# Текст\r\n')
  assert.equal(store.document?.title, 'Current')
})

test('wrong store is rejected before content is requested', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return json({ ...metadata, storeId: 'other' })
  }
  const store = useArtifactsStore()
  await store.select({ storeId, id })
  assert.equal(calls, 1)
  assert.equal(store.document, null)
  assert.match(store.documentError ?? '', /another artifact store/)
})

for (const corrupt of [
  { sha256: 'wrong' },
  { id: 'wrong' },
  { offset: 4 },
  { text: 'truncated' },
  { text: '', nextOffset: 0 }
]) {
  test(
    'invalid content cannot appear in the viewer: ' + JSON.stringify(corrupt),
    async () => {
      globalThis.fetch = async input =>
        json(
          (typeof input === 'string' ? input : '').includes('/content')
            ? { ...chunk(), ...corrupt }
            : metadata
        )
      const store = useArtifactsStore()
      await store.select({ storeId, id })
      // Metadata stay usable; only the unproven text is withheld.
      assert.equal(store.document?.id, id)
      assert.equal(store.documentError, null)
      assert.equal(store.body, '')
      assert.equal(store.contentState, 'error')
      assert.equal(store.contentErrorKind, 'integrity')
      assert.ok(store.contentError)
    }
  )
}

test('clearing selection ignores a late response even if transport ignores abort', async () => {
  const pending = deferred<Response>()
  globalThis.fetch = async () => pending.promise
  const store = useArtifactsStore()
  const loading = store.select({ storeId, id })
  await store.select(null)
  pending.resolve(json(metadata))
  await loading
  assert.equal(store.document, null)
  assert.equal(store.documentError, null)
  assert.equal(store.documentLoading, false)
})

test('teardown prevents queued catch-up from starting another request', async () => {
  const pending = deferred<Response>()
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return pending.promise
  }
  const store = useArtifactsStore()
  const initial = store.search({})
  const catchup = store.refresh()
  store.cancel()
  pending.resolve(json(page()))
  await Promise.all([initial, catchup])
  assert.equal(calls, 1)
  assert.equal(store.catalog, null)
  assert.equal(store.loading, false)
})

test('metadata catch-up keeps the mounted document and does not reread immutable content', async () => {
  let contentReads = 0
  globalThis.fetch = async input => {
    if (typeof input === 'string' && input.includes('/content')) {
      contentReads++
      return json(chunk())
    }
    return json(metadata)
  }
  const store = useArtifactsStore()
  await store.select({ storeId, id })
  const pending = deferred<Response>()
  globalThis.fetch = async () => pending.promise
  const refreshing = store.refreshDocument()
  assert.equal(store.document?.id, id)
  assert.equal(store.body, '# Текст\r\n')
  pending.resolve(json({ ...metadata, title: 'Updated', metadataVersion: 2 }))
  await refreshing
  assert.equal(contentReads, 1)
  assert.equal(store.document?.title, 'Updated')
  assert.equal(store.body, '# Текст\r\n')
})

test('catch-up retains loaded depth using fresh cursors and publishes only complete results', async () => {
  const requests: (string | undefined)[] = []
  let epoch = 1
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(typeof init?.body === 'string' ? init.body : '')
    requests.push(input.cursor)
    return json({
      ...page(input.cursor ? 'Second' : 'First'),
      storeEpoch: epoch,
      indexEpoch: epoch,
      items: [{ ...page().items[0]!, id: input.cursor ? 'second' : 'first' }],
      nextCursor: input.cursor ? null : 'epoch-' + epoch
    })
  }
  const store = useArtifactsStore()
  await store.search({ limit: 1 })
  await store.loadMore()
  epoch = 2
  await store.refresh()
  assert.deepEqual(
    store.catalog?.items.map(item => item.id),
    ['first', 'second']
  )
  assert.deepEqual(requests, [undefined, 'epoch-1', undefined, 'epoch-2'])
  assert.equal(store.stale, false)
})
test('an epoch change during catch-up falls back to the first fresh page', async () => {
  let changed = false
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(typeof init?.body === 'string' ? init.body : '')
    return json({
      ...page(input.cursor ? 'Second' : 'First'),
      nextCursor: input.cursor ? null : 'next',
      storeEpoch: changed && input.cursor ? 2 : 1
    })
  }
  const store = useArtifactsStore()
  await store.search({ limit: 1 })
  await store.loadMore()
  changed = true
  await store.refresh()
  assert.equal(store.catalog?.items.length, 1)
  assert.equal(store.stale, false)
  assert.equal(store.error, null)
})
test('a new search supersedes a multi-page catch-up without publishing its partial results', async () => {
  let catchUp = false
  const waiting = deferred<Response>()
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(typeof init?.body === 'string' ? init.body : '')
    if (input.query === 'new') return json(page('New search'))
    if (catchUp && input.cursor) return waiting.promise
    return json({
      ...page(input.cursor ? 'Second' : 'First'),
      nextCursor: input.cursor ? null : 'next'
    })
  }
  const store = useArtifactsStore()
  await store.search({})
  await store.loadMore()
  catchUp = true
  const refreshing = store.refresh()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(store.catalog?.items.length, 2)
  const searching = store.search({ query: 'new' })
  waiting.resolve(json(page('Old late page')))
  await Promise.all([refreshing, searching])
  assert.equal(store.catalog?.items[0]?.title, 'New search')
})

test('catch-up beyond five pages retains stale results until explicit reload', async () => {
  let requests = 0
  globalThis.fetch = async (_url, init) => {
    ++requests
    const input = JSON.parse(typeof init?.body === 'string' ? init.body : '')
    const cursor = Number(input.cursor ?? 0)
    return json({ ...page(), nextCursor: String(cursor + 1) })
  }
  const store = useArtifactsStore()
  await store.search({ limit: 1 })
  for (let index = 0; index < 5; index++) await store.loadMore()
  assert.equal(store.catalog?.items.length, 6)
  await store.refresh()
  assert.equal(requests, 6)
  assert.equal(store.catalog?.items.length, 6)
  assert.equal(store.stale, true)
  await store.reload()
  assert.equal(store.catalog?.items.length, 1)
  assert.equal(store.stale, false)
})
test('an event during multi-page catch-up queues a complete second traversal', async () => {
  let catchingUp = false
  let requests = 0
  const waiting = deferred<Response>()
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(typeof init?.body === 'string' ? init.body : '')
    if (catchingUp && ++requests === 2) return waiting.promise
    return json({ ...page(), nextCursor: input.cursor ? null : 'fresh' })
  }
  const store = useArtifactsStore()
  await store.search({})
  await store.loadMore()
  catchingUp = true
  const first = store.refresh()
  await new Promise<void>(resolve => setImmediate(resolve))
  const second = store.refresh()
  waiting.resolve(json(page()))
  await Promise.all([first, second])
  assert.equal(requests, 4)
  assert.equal(store.catalog?.items.length, 2)
})

test('catch-up returns a clean first page when the catalog shrinks below the loaded depth', async () => {
  let shrunk = false
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(typeof init?.body === 'string' ? init.body : '')
    return json({
      ...page(input.cursor ? 'Second' : 'First'),
      nextCursor: shrunk || input.cursor ? null : 'next'
    })
  }
  const store = useArtifactsStore()
  await store.search({})
  await store.loadMore()
  shrunk = true
  await store.refresh()
  assert.equal(store.catalog?.items.length, 1)
  assert.equal(store.stale, false)
  assert.equal(store.error, null)
})

test('a rejected fresh cursor after an epoch change falls back to the first clean page', async () => {
  let changed = false
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(typeof init?.body === 'string' ? init.body : '')
    if (changed && input.cursor) {
      return json({ message: 'Store changed. Restart pagination.' }, 409)
    }
    return json({
      ...page(input.cursor ? 'Second' : 'First'),
      nextCursor: input.cursor ? null : 'next'
    })
  }
  const store = useArtifactsStore()
  await store.search({})
  await store.loadMore()
  changed = true
  await store.refresh()
  assert.equal(store.catalog?.items.length, 1)
  assert.equal(store.catalog?.items[0]?.title, 'First')
  assert.equal(store.stale, false)
  assert.equal(store.error, null)
})

function contentApi(options: {
  failWith?: () => Response | Promise<never>
  reads?: { count: number }
}) {
  return async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : ''
    if (!url.includes('/content')) {
      return json(metadata)
    }
    if (options.reads) {
      options.reads.count++
    }
    return options.failWith ? options.failWith() : json(chunk())
  }
}

test('an integrity error from the server keeps metadata and classifies the failure by code', async () => {
  globalThis.fetch = contentApi({
    failWith: () =>
      json(
        { code: 'GHT_ARTIFACT_INTEGRITY', message: 'Stored file changed.' },
        422
      )
  })
  const store = useArtifactsStore()
  await store.select({ storeId, id })
  assert.equal(store.document?.title, 'Current')
  assert.equal(store.contentState, 'error')
  assert.equal(store.contentErrorKind, 'integrity')
})

test('a 422 without the integrity code and a network failure are not integrity errors', async () => {
  globalThis.fetch = contentApi({
    failWith: () => json({ message: 'Stored file changed.' }, 422)
  })
  const store = useArtifactsStore()
  await store.select({ storeId, id })
  assert.equal(store.contentErrorKind, 'transport')
  globalThis.fetch = contentApi({
    failWith: () => Promise.reject(new TypeError('network'))
  })
  await store.retryContent()
  assert.equal(store.contentErrorKind, 'transport')
  assert.equal(store.contentState, 'error')
})

test('retry reads the body again after metadata published, and an empty body is ready', async () => {
  let fail = true
  const reads = { count: 0 }
  globalThis.fetch = async input => {
    const url = typeof input === 'string' ? input : ''
    if (!url.includes('/content')) {
      return json(metadata)
    }
    reads.count++
    return fail ? json({ message: 'down' }, 500) : json(chunk())
  }
  const store = useArtifactsStore()
  await store.select({ storeId, id })
  assert.equal(store.contentState, 'error')
  fail = false
  await store.retryContent()
  assert.equal(reads.count, 2)
  assert.equal(store.contentState, 'ready')
  assert.equal(store.body, '# Текст\r\n')
  assert.equal(store.contentError, null)
})

test('background catch-up after a content error does not read the body again', async () => {
  const reads = { count: 0 }
  globalThis.fetch = contentApi({
    reads,
    failWith: () => json({ message: 'down' }, 500)
  })
  const store = useArtifactsStore()
  await store.select({ storeId, id })
  await store.refreshDocument()
  await store.refreshDocument()
  assert.equal(reads.count, 1)
  assert.equal(store.contentState, 'error')
  assert.equal(store.document?.id, id)
})

test('a forced retry checks a verified body again and keeps it ready while verifying', async () => {
  const reads = { count: 0 }
  globalThis.fetch = contentApi({ reads })
  const store = useArtifactsStore()
  await store.select({ storeId, id })
  assert.equal(reads.count, 1)
  const pending = deferred<Response>()
  globalThis.fetch = async input =>
    typeof input === 'string' && input.includes('/content')
      ? pending.promise
      : json(metadata)
  const retrying = store.retryContent()
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(store.contentState, 'ready')
  assert.equal(store.verifying, true)
  pending.resolve(json(chunk()))
  await retrying
  assert.equal(store.verifying, false)
  assert.equal(store.contentState, 'ready')
})

function forceHarness(options: {
  gate?: ReturnType<typeof deferred<Response>>
}) {
  const reads = { count: 0 }
  let firstGet = true
  globalThis.fetch = async input => {
    const url = typeof input === 'string' ? input : ''
    if (url.includes('/content')) {
      reads.count++
      return json(chunk())
    }
    if (url.includes('/api/artifacts/search')) {
      return json(page())
    }
    if (options.gate && firstGet) {
      firstGet = false
      return options.gate.promise
    }
    return json(metadata)
  }
  return reads
}

test('a forced retry queued behind a running catch-up still checks the body, and joined catch-ups do not downgrade it', async () => {
  const store = useArtifactsStore()
  const ready = forceHarness({})
  await store.select({ storeId, id })
  assert.equal(ready.count, 1)
  const gate = deferred<Response>()
  const reads = forceHarness({ gate })
  const running = store.refreshDocument()
  const forced = store.retryContent()
  const joined = store.refreshDocument()
  gate.resolve(json(metadata))
  await Promise.all([running, forced, joined])
  // Without the queued force no read would follow the metadata-only run.
  assert.equal(reads.count, 1)
  assert.equal(store.contentState, 'ready')
  assert.equal(store.verifying, false)
})

test('a queued force request is dropped by a change of selection', async () => {
  const store = useArtifactsStore()
  forceHarness({})
  await store.select({ storeId, id })
  const gate = deferred<Response>()
  const reads = forceHarness({ gate })
  const running = store.refreshDocument()
  const forced = store.retryContent()
  await store.select({ storeId, id })
  gate.resolve(json(metadata))
  await Promise.all([running, forced])
  // The verified body is reused: the dropped force request reads nothing.
  assert.equal(reads.count, 0)
  assert.equal(store.contentState, 'ready')
})

test('a retry after teardown is ignored and cannot wake up with a later search', async () => {
  const store = useArtifactsStore()
  forceHarness({})
  await store.select({ storeId, id })
  store.cancel()
  await store.retryContent()
  const reads = forceHarness({})
  await store.search({})
  await store.refreshDocument()
  assert.equal(reads.count, 0)
})

test('a failed metadata read during a body read leaves no endless spinner', async () => {
  const store = useArtifactsStore()
  const slow = deferred<Response>()
  globalThis.fetch = async input =>
    typeof input === 'string' && input.includes('/content')
      ? slow.promise
      : json(metadata)
  const first = store.select({ storeId, id })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(store.contentState, 'loading')
  globalThis.fetch = async () => json({ message: 'down' }, 500)
  await store.refreshDocument()
  slow.resolve(json(chunk()))
  await first
  assert.notEqual(store.contentState, 'loading')
  assert.ok(store.documentError)
})
