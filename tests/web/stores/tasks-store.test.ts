import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { tasksApi, type TaskListOptions } from '@/api/tasks'
import { useTasksStore } from '@/stores/tasks-store'
import { defaultTaskFilter, taskFilterActive } from '@/utils/task-filter'

test('task list starts with open tasks and resetting filters requests all states', async t => {
  setActivePinia(createPinia())
  const requests: TaskListOptions[] = []
  t.mock.method(tasksApi, 'list', async (options: TaskListOptions) => {
    requests.push(options)
    return { items: [], nextCursor: null, storeId: 'store', storeEpoch: 1 }
  })
  const store = useTasksStore()
  await store.refresh()
  assert.equal(requests[0]?.state, 'open')
  assert.equal(
    taskFilterActive({
      state: store.state,
      tags: store.tags,
      tagMode: store.tagMode
    }),
    true
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
