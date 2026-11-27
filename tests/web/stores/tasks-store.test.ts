import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { tasksApi, type TaskListOptions } from '@/api/tasks'
import { useTasksStore } from '@/stores/tasks-store'
import { defaultTaskFilter, taskFilterActive } from '@/utils/task-filter'

test('task list starts with open tasks and resetting filters returns to open', async t => {
  setActivePinia(createPinia())
  const requests: TaskListOptions[] = []
  t.mock.method(tasksApi, 'list', async (options: TaskListOptions) => {
    requests.push(options)
    return { items: [], nextCursor: null, storeId: 'store', storeEpoch: 1 }
  })
  const store = useTasksStore()
  assert.equal(store.state, 'open')
  await store.refresh()
  assert.equal(requests[0]?.state, 'open')
  assert.equal(
    taskFilterActive({
      state: store.state,
      tags: store.tags,
      tagMode: store.tagMode
    }),
    false
  )
  await store.setFilters({ state: 'all' })
  assert.equal(requests[1]?.state, 'all')
  assert.equal(
    taskFilterActive({
      state: store.state,
      tags: store.tags,
      tagMode: store.tagMode
    }),
    true
  )
  await store.setFilters({ state: 'closed' })
  assert.equal(requests[2]?.state, 'closed')
  await store.setFilters(defaultTaskFilter())
  assert.equal(requests[3]?.state, 'open')
  assert.deepEqual(store.tags, [])
  assert.equal(
    taskFilterActive({
      state: store.state,
      tags: store.tags,
      tagMode: store.tagMode
    }),
    false
  )
})

test('taskFilterActive treats selected tags as a change of the default filter', () => {
  assert.equal(
    taskFilterActive({ state: 'open', tags: [], tagMode: 'all' }),
    false
  )
  for (const filter of [
    { state: 'all' as const, tags: [], tagMode: 'all' as const },
    { state: 'closed' as const, tags: [], tagMode: 'all' as const },
    { state: 'open' as const, tags: ['ui'], tagMode: 'all' as const }
  ]) {
    assert.equal(taskFilterActive(filter), true)
  }
})

test('loading is cleared when refreshLoaded replaces a running refresh', async t => {
  setActivePinia(createPinia())
  const releases: Array<() => void> = []
  t.mock.method(tasksApi, 'list', () => {
    return new Promise(resolve => {
      releases.push(() =>
        resolve({
          items: [],
          nextCursor: null,
          storeId: 'store',
          storeEpoch: 1
        })
      )
    })
  })
  const store = useTasksStore()
  const first = store.refresh()
  const second = store.refreshLoaded()
  assert.equal(store.loading, true)
  while (releases.length) {
    releases.shift()!()
    await new Promise(resolve => setImmediate(resolve))
  }
  await Promise.all([first, second])
  assert.equal(store.loading, false)
})
