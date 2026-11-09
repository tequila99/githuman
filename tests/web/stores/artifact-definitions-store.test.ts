import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import {
  createArtifactDefinitions,
  useArtifactDefinitionsStore
} from '@/stores/artifact-definitions-store'
import type { Task, ArtifactType } from '@/api/types'

const task: Task = {
  storeId: 'store',
  id: 'task',
  version: 1,
  title: 'Task name',
  description: '',
  links: [],
  tags: [],
  state: 'open',
  createdAt: '2026-01-01T00:00:00.000Z'
}
const type: ArtifactType = {
  storeId: 'store',
  id: 'custom',
  version: 1,
  label: 'Type name',
  active: true
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}
function data(
  value: Task | ArtifactType,
  epoch = 1,
  nextCursor: string | null = null
) {
  return { storeId: 'store', storeEpoch: epoch, items: [value], nextCursor }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
let savedFetch: typeof fetch
beforeEach(() => {
  savedFetch = globalThis.fetch
  setActivePinia(createPinia())
})
afterEach(() => {
  globalThis.fetch = savedFetch
})

test('restored selected IDs are resolved by name independently of the first page, including inactive and closed definitions', async () => {
  globalThis.fetch = async input =>
    json(
      typeof input === 'string' && input.startsWith('/api/tasks/')
        ? { ...task, state: 'closed' }
        : { ...type, active: false }
    )
  const definitions = createArtifactDefinitions('store')
  await Promise.all([
    definitions.resolve('task', 'task'),
    definitions.resolve('type', 'custom')
  ])
  assert.equal(definitions.taskLabels.get('task')?.title, 'Task name')
  assert.equal(definitions.taskLabels.get('task')?.state, 'closed')
  assert.equal(definitions.typeLabels.get('custom')?.active, false)
})

test('duplicate name lookups share a request and old versions cannot overwrite newer list records', async () => {
  const pending = deferred<Response>()
  let lookups = 0
  globalThis.fetch = async input => {
    if (input === '/api/tasks/task') {
      lookups++
      return pending.promise
    }
    return json(
      typeof input === 'string' && input.startsWith('/api/tasks?')
        ? data({ ...task, title: 'New label', version: 2 })
        : data(type)
    )
  }
  const definitions = createArtifactDefinitions('store')
  const first = definitions.resolve('task', 'task')
  const second = definitions.resolve('task', 'task')
  await definitions.tasks.setActive(true)
  pending.resolve(json(task))
  await Promise.all([first, second])
  assert.equal(lookups, 1)
  assert.equal(definitions.taskLabels.get('task')?.title, 'New label')
})

test('stale lookup responses after invalidation cannot repopulate labels', async () => {
  const pending = deferred<Response>()
  globalThis.fetch = async () => pending.promise
  const definitions = createArtifactDefinitions('store')
  const reading = definitions.resolve('type', 'custom')
  await definitions.invalidate()
  pending.resolve(json(type))
  await reading
  assert.equal(definitions.typeLabels.has('custom'), false)
})

test('wrong stores and identity responses cannot become selected labels', async () => {
  const definitions = createArtifactDefinitions('store')
  globalThis.fetch = async () => json({ ...task, storeId: 'other' })
  await assert.rejects(definitions.resolve('task', 'task'), /another store/)
  globalThis.fetch = async () => json({ ...type, id: 'different' })
  await assert.rejects(
    definitions.resolve('type', 'custom'),
    /identity changed/
  )
  assert.equal(definitions.taskLabels.size, 0)
  assert.equal(definitions.typeLabels.size, 0)
})

test('definition pagination rejects changed epochs and preserves the existing page', async () => {
  globalThis.fetch = async () => json(data(task, 1, 'next'))
  const definitions = createArtifactDefinitions('store')
  await definitions.tasks.setActive(true)
  globalThis.fetch = async () => json(data({ ...task, id: 'task-2' }, 2))
  await definitions.tasks.more()
  assert.equal(definitions.tasks.state.page?.items.length, 1)
  assert.equal(definitions.tasks.state.stale, true)
  assert.equal(definitions.taskLabels.has('task-2'), false)
})

test('closing and reentering the page refreshes catalogs instead of trusting an old cache', async () => {
  let name = 'First'
  globalThis.fetch = async input =>
    json(
      typeof input === 'string' && input.startsWith('/api/tasks?')
        ? data({ ...task, title: name })
        : data(type)
    )
  const definitions = createArtifactDefinitions('store')
  const release = definitions.retain()
  await definitions.tasks.refresh()
  release()
  name = 'After return'
  const releaseAgain = definitions.retain()
  await definitions.tasks.refresh()
  assert.equal(definitions.taskLabels.get('task')?.title, 'After return')
  releaseAgain()
})

test('store-scoped task caches are independent', () => {
  const store = useArtifactDefinitionsStore()
  assert.notEqual(
    store.forStore('store').taskLabels,
    store.forStore('other').taskLabels
  )
})

test('catalog labels resolve IDs beyond initial pages with four requests at a time and retain failed lookups', async () => {
  let active = 0
  let peak = 0
  let failures = 0
  globalThis.fetch = async input => {
    const url = typeof input === 'string' ? input : ''
    ++active
    peak = Math.max(peak, active)
    await new Promise<void>(resolve => setImmediate(resolve))
    --active
    if (url.endsWith('/missing')) {
      ++failures
      return json({ message: 'Missing' }, 404)
    }
    const id = url.split('/').at(-1)!
    return json(url.includes('/api/tasks/') ? { ...task, id } : { ...type, id })
  }
  const definitions = createArtifactDefinitions('store')
  const items = Array.from({ length: 9 }, (_, index) => ({
    typeId: 'type-' + index,
    taskIds: ['task-' + index, 'missing']
  }))
  await definitions.resolveCatalog(items)
  await definitions.resolveCatalog(items)
  assert.equal(definitions.taskLabels.get('task-8')?.title, 'Task name')
  assert.equal(definitions.typeLabels.get('type-8')?.label, 'Type name')
  assert.equal(failures, 1)
  assert.ok(peak <= 4)
})

test('unavailable catalog labels retry after invalidation or the last owner releases', async () => {
  let failures = 0
  globalThis.fetch = async input => {
    const url = typeof input === 'string' ? input : ''
    if (url.endsWith('/missing')) {
      ++failures
      return json({ message: 'Missing' }, 404)
    }
    return json({
      storeId: 'store',
      storeEpoch: 1,
      items: [],
      nextCursor: null
    })
  }
  const definitions = createArtifactDefinitions('store')
  const items = [{ typeId: '', taskIds: ['missing'] }]
  const release = definitions.retain()
  await definitions.resolveCatalog(items)
  await definitions.resolveCatalog(items)
  assert.equal(failures, 1)
  await definitions.invalidate()
  assert.equal(failures, 2)
  release()
  await definitions.resolveCatalog(items)
  assert.equal(failures, 3)
})

test('two active consumers share one subscription and release it only after the last owner', async () => {
  let subscriptions = 0
  let releases = 0
  globalThis.fetch = async input =>
    json(
      data(
        (typeof input === 'string' ? input : '').startsWith('/api/tasks?')
          ? task
          : type
      )
    )
  const definitions = createArtifactDefinitions('store', () => {
    ++subscriptions
    return () => {
      ++releases
    }
  })
  const first = definitions.retain()
  const second = definitions.retain()
  await definitions.tasks.refresh()
  assert.equal(subscriptions, 1)
  first()
  assert.equal(releases, 0)
  second()
  assert.equal(releases, 1)
})

test('failed refresh keeps successful labels while explicit invalidation retries them', async () => {
  let failed = false
  globalThis.fetch = async input =>
    failed
      ? json({ message: 'Offline' }, 500)
      : json(
          (typeof input === 'string' ? input : '').startsWith('/api/tasks?')
            ? data(task)
            : data(type)
        )
  const definitions = createArtifactDefinitions('store')
  const release = definitions.retain()
  await definitions.tasks.refresh()
  assert.equal(definitions.taskLabels.get(task.id)?.title, task.title)
  failed = true
  await definitions.invalidate()
  assert.equal(definitions.taskLabels.get(task.id)?.title, task.title)
  assert.ok(definitions.tasks.state.error)
  failed = false
  await definitions.invalidate()
  assert.equal(definitions.tasks.state.error, null)
  release()
})

test('the discovery task page becomes the first catalog read without another HTTP request', async () => {
  let taskRequests = 0
  globalThis.fetch = async input => {
    if ((typeof input === 'string' ? input : '').startsWith('/api/tasks?')) {
      ++taskRequests
    }
    return json(data(type))
  }
  const definitions = createArtifactDefinitions('store', undefined, {
    ...data(task),
    items: [{ ...task, artifactCount: 0 }]
  })
  const release = definitions.retain()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(definitions.tasks.state.page?.items[0]?.id, task.id)
  assert.equal(taskRequests, 0)
  release()
})

test('a picker search sends its text to the server and drops stale results', async () => {
  const urls: string[] = []
  globalThis.fetch = async input => {
    urls.push(typeof input === 'string' ? input : '')
    return json(data(task))
  }
  const definitions = createArtifactDefinitions('store')
  const search = definitions.openSearch('task')
  await search.setText('na me')
  assert.match(urls.at(-1)!, /^\/api\/tasks\?.*search=na%20me/)
  await search.setText('')
  assert.doesNotMatch(urls.at(-1)!, /search=/)
  search.close()
  assert.equal(search.state.page, null)
})

test('store invalidation refreshes open picker searches without a manual refresh', async () => {
  let title = 'First'
  globalThis.fetch = async () => json(data({ ...task, title }))
  const definitions = createArtifactDefinitions('store')
  const search = definitions.openSearch('task')
  await search.refresh()
  title = 'Second'
  await definitions.invalidate()
  assert.equal(
    (search.state.page?.items[0] as Task | undefined)?.title,
    'Second'
  )
  search.close()
})
