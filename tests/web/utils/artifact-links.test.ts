import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createArtifactLinks } from '@/utils/artifact-links'

// Restore the transport after each isolated link workflow.
const ORIGINAL_FETCH = globalThis.fetch

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
})
function fixture() {
  let targets = ['a']
  let title = 'First'
  let fail = false
  const reads: string[] = []
  globalThis.fetch = async input => {
    const url = typeof input === 'string' ? input : ''
    if (url.includes('/relations?')) {
      return Response.json({
        storeId: 'store',
        storeEpoch: 1,
        items: url.includes('direction=incoming')
          ? []
          : (url.includes('cursor=') ? ['b'] : targets).map(targetId => ({
              sourceId: 'document',
              targetId,
              kind: 'references'
            })),
        nextCursor:
          !url.includes('cursor=') && url.includes('direction=outgoing')
            ? 'next'
            : null
      })
    }
    if (url.includes('/ancestry?')) {
      return Response.json({
        storeId: 'store',
        storeEpoch: 1,
        artifactId: 'document',
        ancestorIds: [],
        nextCursor: null
      })
    }
    const id = url.split('/').at(-1)!
    reads.push(id)
    if (fail) return Response.json({ message: 'Unavailable' }, { status: 500 })
    return Response.json({ storeId: 'store', id, title })
  }
  return {
    reads,
    targets: (ids: string[]) => {
      targets = ids
    },
    title: (value: string) => {
      title = value
    },
    fail: (value: boolean) => {
      fail = value
    }
  }
}

test('link pagination resolves only new titles and invalidation updates names for unchanged IDs', async () => {
  const api = fixture()
  const model = createArtifactLinks({ storeId: 'store', id: 'document' })
  await model.setActive(true)
  assert.deepEqual(api.reads, ['a'])
  await model.more()
  assert.deepEqual(api.reads, ['a', 'b'])
  api.title('Renamed')
  await model.invalidate()
  assert.equal(model.names.titles.get('a'), 'Renamed')
  assert.equal(model.names.titles.has('b'), false)
  model.dispose()
})

test('refresh waits for the title of the final link set and ignores a response after hiding', async () => {
  const api = fixture()
  const model = createArtifactLinks({ storeId: 'store', id: 'document' })
  await model.setActive(true)
  api.targets(['new'])
  const transport = globalThis.fetch
  let finish!: () => void
  let started!: () => void
  const reading = new Promise<void>(resolve => {
    started = resolve
  })
  globalThis.fetch = async (input, init) => {
    if ((typeof input === 'string' ? input : '').endsWith('/new')) {
      started()
      await new Promise<void>(resolve => {
        finish = resolve
      })
    }
    return transport(input, init)
  }
  let done = false
  const refresh = model.invalidate().then(() => {
    done = true
    return true
  })
  await reading
  assert.equal(done, false)
  await model.setActive(false)
  finish()
  await refresh
  assert.equal(model.names.titles.has('new'), false)
  globalThis.fetch = transport
  const before = api.reads.length
  await model.invalidate()
  assert.equal(api.reads.length, before)
  await model.setActive(true)
  assert.equal(model.names.titles.get('new'), 'First')
  model.dispose()
})

test('a failed title refresh keeps the previous title, reports the error and can retry', async () => {
  const api = fixture()
  const model = createArtifactLinks({ storeId: 'store', id: 'document' })
  await model.setActive(true)
  api.fail(true)
  await model.invalidate()
  assert.equal(model.names.titles.get('a'), 'First')
  assert.ok(model.error.value)
  api.fail(false)
  api.title('Recovered')
  await model.invalidate()
  assert.equal(model.names.titles.get('a'), 'Recovered')
  assert.equal(model.error.value, null)
  model.dispose()
})

test('title lookups deduplicate IDs and use at most four concurrent requests', async () => {
  const api = fixture()
  api.targets(['a', 'a', 'b', 'c', 'd', 'e', 'f'])
  const transport = globalThis.fetch
  let pending = 0
  let maximum = 0
  globalThis.fetch = async (input, init) => {
    if (!(typeof input === 'string' ? input : '').includes('?')) {
      maximum = Math.max(maximum, ++pending)
      await new Promise(resolve => setImmediate(resolve))
      --pending
    }
    return transport(input, init)
  }
  const model = createArtifactLinks({ storeId: 'store', id: 'document' })
  await model.setActive(true)
  assert.equal(maximum, 4)
  assert.equal(api.reads.length, 6)
  model.dispose()
})
