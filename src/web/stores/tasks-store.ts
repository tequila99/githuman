import { shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { tasksApi, type TaskStateFilter } from '@/api/tasks'
import type { Task, TaskList } from '@/api/types'
import { singleFlight } from '@/utils/single-flight'
import { errorMessage } from '@/utils/error-message'
import { defaultTaskFilter } from '@/utils/task-filter'

export const useTasksStore = defineStore('tasks', () => {
  const items = shallowRef<TaskList['items']>([])
  const nextCursor = shallowRef<string | null>(null)
  const storeId = shallowRef<string | null>(null)
  const loading = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const query = shallowRef('')
  const state = shallowRef<TaskStateFilter>(defaultTaskFilter().state)
  const tags = shallowRef<string[]>([])
  const tagMode = shallowRef<'all' | 'any'>('all')

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
    const mine = ++generation
    loading.value = true
    try {
      const page = await tasksApi.list(filterOptions())
      if (mine !== generation) return
      items.value = page.items
      nextCursor.value = page.nextCursor
      storeId.value = page.storeId
      error.value = null
    } catch (err) {
      if (mine === generation) {
        error.value = errorMessage(err)
      }
    } finally {
      if (mine === generation) loading.value = false
    }
  })

  // Re-reads as many pages as are loaded, so the list keeps its length and scroll position.
  const refreshLoaded = singleFlight(async () => {
    const wanted = items.value.length
    const mine = ++generation
    // Take over the loading flag: the request this one replaces cannot clear it any more.
    loading.value = true
    try {
      let page = await tasksApi.list(filterOptions())
      let all = page.items
      while (all.length < wanted && page.nextCursor) {
        page = await tasksApi.list({
          cursor: page.nextCursor,
          ...filterOptions()
        })
        all = [...all, ...page.items]
      }
      if (mine !== generation) return
      items.value = all
      nextCursor.value = page.nextCursor
      storeId.value = page.storeId
      error.value = null
    } catch (err) {
      if (mine === generation) error.value = errorMessage(err)
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
    refreshLoaded,
    loadMore,
    setFilters,
    remember
  }
})
