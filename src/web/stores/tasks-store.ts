import { shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { tasksApi, type TaskStateFilter } from '@/api/tasks'
import type { Task, TaskList } from '@/api/types'
import { singleFlight } from '@/utils/single-flight'
import { errorMessage } from '@/utils/error-message'

export const useTasksStore = defineStore('tasks', () => {
  const items = shallowRef<TaskList['items']>([])
  const nextCursor = shallowRef<string | null>(null)
  const storeId = shallowRef<string | null>(null)
  const loading = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const query = shallowRef('')
  const state = shallowRef<TaskStateFilter>('open')
  const tags = shallowRef<string[]>([])
  const tagMode = shallowRef<'all' | 'any'>('all')

  let controller: AbortController | undefined
  // A new filter or refresh invalidates a page request that is still running.
  let generation = 0

  function filterOptions() {
    return {
      search: query.value,
      state: state.value,
      tags: tags.value,
      tagMode: tagMode.value
    }
  }

  const refresh = singleFlight(async () => {
    controller?.abort()
    controller = new AbortController()
    const mine = ++generation
    loading.value = true
    try {
      const page = await tasksApi.list(filterOptions(), controller.signal)
      if (mine !== generation) return
      items.value = page.items
      nextCursor.value = page.nextCursor
      storeId.value = page.storeId
      error.value = null
    } catch (err) {
      if (mine === generation && !controller.signal.aborted) {
        error.value = errorMessage(err)
      }
    } finally {
      if (mine === generation) loading.value = false
    }
  })

  async function loadMore() {
    const cursor = nextCursor.value
    if (!cursor || loading.value) return
    const mine = generation
    loading.value = true
    try {
      const page = await tasksApi.list({ cursor, ...filterOptions() })
      if (mine !== generation) return
      items.value = [...items.value, ...page.items]
      nextCursor.value = page.nextCursor
    } catch (err) {
      if (mine === generation) error.value = errorMessage(err)
    } finally {
      if (mine === generation) loading.value = false
    }
  }

  function setFilters(next: {
    query?: string
    state?: TaskStateFilter
    tags?: string[]
    tagMode?: 'all' | 'any'
  }) {
    if (next.query !== undefined) query.value = next.query
    if (next.state !== undefined) state.value = next.state
    if (next.tags !== undefined) tags.value = next.tags
    if (next.tagMode !== undefined) tagMode.value = next.tagMode
    return refresh()
  }

  // A saved task replaces its row without a refetch; a new one waits for the refresh.
  function remember(task: Task) {
    const index = items.value.findIndex(item => item.id === task.id)
    if (index < 0) return
    const next = [...items.value]
    next[index] = { ...next[index]!, ...task }
    items.value = next
  }

  return {
    items,
    nextCursor,
    storeId,
    loading,
    error,
    query,
    state,
    tags,
    tagMode,
    refresh,
    loadMore,
    setFilters,
    remember
  }
})
