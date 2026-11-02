import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  createArtifactRelationsPage,
  createArtifactAncestryPage,
  createArtifactHistoryPage
} from '@/utils/artifact-details'
import type {
  ArtifactGraphPage,
  ArtifactHistory,
  ArtifactEvent,
  ArtifactAncestry
} from '@/api/types'

const identity = { storeId: 'store', id: 'document' }
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}
function graph(epoch = 1): ArtifactGraphPage {
  return {
    storeId: 'store',
    storeEpoch: epoch,
    nextCursor: null,
    items: [{ sourceId: 'document', targetId: 'target', kind: 'references' }]
  }
}
function event(seq: number): ArtifactEvent {
  return {
    storeId: 'store',
    artifactId: 'document',
    seq,
    action: seq === 1 ? 'created' : 'metadata_updated',
    requestId: 'r' + seq,
    actor: { kind: 'agent', id: 'agent' },
    createdAt: '',
    beforeVersion: seq === 1 ? null : seq - 1,
    afterVersion: seq,
    metadata: { title: 'Title ' + seq, tags: [] }
  }
}
function history(
  events: ArtifactEvent[],
  nextAfterSeq: number | null = null
): ArtifactHistory {
  return { storeId: 'store', items: events, nextAfterSeq }
}
function ancestry(): ArtifactAncestry {
  return {
    storeId: 'store',
    artifactId: 'document',
    storeEpoch: 1,
    ancestorIds: ['parent'],
    nextCursor: null
  }
}
let savedFetch: typeof fetch
beforeEach(() => {
  savedFetch = globalThis.fetch
})
afterEach(() => {
  globalThis.fetch = savedFetch
})

test('relationship pages bind direction and safely encode opaque cursors', async () => {
  const urls: string[] = []
  globalThis.fetch = async input => {
    assert.equal(typeof input, 'string')
    if (typeof input === 'string') urls.push(input)
    return json(
      urls.length === 1
        ? { ...graph(), nextCursor: 'next&query=wrong' }
        : { ...graph(), items: [{ ...graph().items[0]!, targetId: 'second' }] }
    )
  }
  const detail = createArtifactRelationsPage(identity, 'outgoing')
  await detail.setActive(true)
  await detail.more()
  assert.ok(urls[0]?.includes('direction=outgoing'))
  assert.ok(urls[1]?.includes('cursor=next%26query%3Dwrong'))
  assert.equal(detail.state.page?.items.length, 2)
})

test('incoming links retain their original direction and reject unrelated edges', async () => {
  globalThis.fetch = async () =>
    json({
      ...graph(),
      items: [{ sourceId: 'source', targetId: 'document', kind: 'replaces' }]
    })
  const detail = createArtifactRelationsPage(identity, 'incoming')
  await detail.setActive(true)
  assert.equal(detail.state.page?.items[0]?.sourceId, 'source')
  globalThis.fetch = async () => json(graph())
  await detail.refresh()
  assert.equal(detail.state.stale, true)
  assert.equal(detail.state.page?.items[0]?.sourceId, 'source')
})

test('graph pagination rejects a changed epoch without mixing snapshots', async () => {
  globalThis.fetch = async () => json({ ...graph(), nextCursor: 'next' })
  const detail = createArtifactRelationsPage(identity, 'outgoing')
  await detail.setActive(true)
  globalThis.fetch = async () => json(graph(2))
  await detail.more()
  assert.equal(detail.state.page?.items.length, 1)
  assert.equal(detail.state.stale, true)
  assert.match(detail.state.error ?? '', /graph changed/)
})

test('lineage pagination preserves nearest-first ordering and verifies store epochs', async () => {
  globalThis.fetch = async () => json({ ...ancestry(), nextCursor: 'next' })
  const detail = createArtifactAncestryPage(identity)
  await detail.setActive(true)
  globalThis.fetch = async () =>
    json({ ...ancestry(), ancestorIds: ['grandparent'] })
  await detail.more()
  assert.deepEqual(detail.state.page?.ancestorIds, ['parent', 'grandparent'])
})

test('lineage of another document or a self ancestor cannot replace the current page', async () => {
  for (const wrong of [
    { ...ancestry(), artifactId: 'other' },
    { ...ancestry(), ancestorIds: ['document'] }
  ]) {
    globalThis.fetch = async () => json(wrong)
    const detail = createArtifactAncestryPage(identity)
    await detail.setActive(true)
    assert.equal(detail.state.page, null)
    assert.ok(detail.state.error)
  }
})

test('append-only history continues by actual sequence and preserves earlier payloads', async () => {
  const urls: string[] = []
  globalThis.fetch = async input => {
    if (typeof input === 'string') urls.push(input)
    return json(
      urls.length === 1
        ? history([event(2), event(10)], 10)
        : history([event(20)])
    )
  }
  const detail = createArtifactHistoryPage(identity)
  await detail.setActive(true)
  await detail.more()
  assert.ok(urls[1]?.endsWith('afterSeq=10'))
  assert.deepEqual(
    detail.state.page?.items.map(item => item.seq),
    [2, 10, 20]
  )
  assert.equal(detail.state.page?.items[0]?.metadata.title, 'Title 2')
})

for (const bad of [
  history([{ ...event(1), artifactId: 'other' }]),
  history([{ ...event(1), storeId: 'other' }]),
  history([event(2), event(1)]),
  history([event(1)], 5),
  history([], 1)
]) {
  test(
    'history rejects wrong identity, order or continuation: ' +
      JSON.stringify(bad),
    async () => {
      globalThis.fetch = async () => json(bad)
      const detail = createArtifactHistoryPage(identity)
      await detail.setActive(true)
      assert.equal(detail.state.page, null)
      assert.ok(detail.state.error)
    }
  )
}

test('overlapping history pages do not duplicate events', async () => {
  globalThis.fetch = async () => json(history([event(1), event(2)], 2))
  const detail = createArtifactHistoryPage(identity)
  await detail.setActive(true)
  globalThis.fetch = async () => json(history([event(2), event(3)]))
  await detail.more()
  assert.equal(detail.state.page?.items.length, 2)
  assert.equal(detail.state.stale, true)
})
