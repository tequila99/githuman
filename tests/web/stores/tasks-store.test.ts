import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { tasksApi, type TaskListOptions } from '@/api/tasks'
import { useTasksStore } from '@/stores/tasks-store'
import { defaultTaskFilter, taskFilterActive } from '@/utils/task-filter'

test('task list starts with the default filter and resetting filters keeps it', async t => {
  setActivePinia(createPinia())
  const requests: TaskListOptions[] = []
  t.mock.method(tasksApi, 'list', async (options: TaskListOptions) => {
    requests.push(options)
    return { items: [], nextCursor: null, storeId: 'store', storeEpoch: 1 }
  })
  const store = useTasksStore()
  await store.refresh()
  assert.equal(requests[0]?.state, defaultTaskFilter().state)
  assert.equal(
    taskFilterActive({
      state: store.state,
      tags: store.tags,
      tagMode: store.tagMode
    }),
    false
  )
  await store.setFilters(defaultTaskFilter())
  assert.equal(requests[1]?.state, 'all')
  assert.equal(
    taskFilterActive({
      state: store.state,
      tags: store.tags,
      tagMode: store.tagMode
    }),
    false
  )
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
