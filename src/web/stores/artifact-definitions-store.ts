import { shallowReactive, watch } from 'vue'
import { defineStore } from 'pinia'
import { useServerEvents } from '@/composables/use-server-events'
import { artifactDefinitionsApi as api } from '@/api/artifact-definitions'
import type {
  Task,
  TaskList,
  ArtifactType,
  ArtifactTypeList,
  ArtifactSearchItem
} from '@/api/types'
import { createArtifactDetailPage } from '@/utils/artifact-detail-page'

// Bound individual definition requests without adding a batch endpoint.
const DEFINITION_LOOKUP_CONCURRENCY = 4

function mergeDefinitionPages<
  Page extends { storeEpoch: number; items: (Task | ArtifactType)[] }
>(previous: Page, next: Page): Page {
  if (previous.storeEpoch !== next.storeEpoch) {
    throw new Error('The definitions changed. Refresh before reading more.')
  }
  return { ...next, items: [...previous.items, ...next.items] }
}

export function createArtifactDefinitions(
  storeId: string,
  subscribe?: (invalidate: () => void) => () => void,
  initialTasks?: TaskList
) {
  const taskLabels = shallowReactive(new Map<string, Task>())
  const typeLabels = shallowReactive(new Map<string, ArtifactType>())
  const lookups = new Map<string, Promise<void>>()
  const wanted = new Map<string, { kind: 'task' | 'type'; id: string }>()
  const unavailable = new Set<string>()
  const outdated = new Set<string>()
  const controllers = new Set<AbortController>()
  const searches = new Set<{ invalidate: () => Promise<void> }>()
  let unsubscribe: (() => void) | undefined
  let batch: Promise<void> = Promise.resolve()
  let generation = 0
  let owners = 0

  function remember<T extends { storeId: string; id: string; version: number }>(
    cache: Map<string, T>,
    item: T,
    kind: 'task' | 'type'
  ) {
    if (item.storeId !== storeId) {
      throw new Error('Definition belongs to another store.')
    }
    if ((cache.get(item.id)?.version ?? 0) <= item.version) {
      cache.set(item.id, item)
      outdated.delete(kind + ':' + item.id)
    }
  }
  function assertItems(items: (Task | ArtifactType)[]) {
    if (items.some(item => item.storeId !== storeId)) {
      throw new Error('Definitions belong to another store.')
    }
  }
  let firstTasks = initialTasks
  const tasks = createArtifactDetailPage<TaskList, string>({
    storeId,
    fetch: (cursor, signal) => {
      const initial = cursor === null ? firstTasks : undefined
      firstTasks = undefined
      return initial
        ? Promise.resolve(initial)
        : api.tasks(cursor ?? undefined, signal)
    },
    cursor: page => page.nextCursor,
    validate: page => assertItems(page.items),
    append: mergeDefinitionPages
  })
  const types = createArtifactDetailPage<ArtifactTypeList, string>({
    storeId,
    fetch: (cursor, signal) => api.types(cursor ?? undefined, signal),
    cursor: page => page.nextCursor,
    validate: page => assertItems(page.items),
    append: mergeDefinitionPages
  })
  watch(
    [() => tasks.state.page, () => types.state.page],
    ([taskPage, typePage], [previousTaskPage, previousTypePage]) => {
      if (taskPage !== previousTaskPage) {
        for (const item of taskPage?.items ?? []) {
          remember(taskLabels, item, 'task')
        }
      }
      if (typePage !== previousTypePage) {
        for (const item of typePage?.items ?? []) {
          remember(typeLabels, item, 'type')
        }
      }
    },
    { flush: 'sync' }
  )

  // One page per picker: each picker owns its search text, so pickers cannot
  // overwrite each other. The store invalidates these pages with the catalogs.
  function openSearch(kind: 'task' | 'type') {
    let text = ''
    const page = createArtifactDetailPage<TaskList | ArtifactTypeList, string>({
      storeId,
      fetch: (cursor, signal) =>
        kind === 'task'
          ? api.tasks(cursor ?? undefined, signal, text)
          : api.types(cursor ?? undefined, signal, text),
      cursor: next => next.nextCursor,
      validate: next => assertItems(next.items),
      append: mergeDefinitionPages
    })
    searches.add(page)
    void page.setActive(true)
    return {
      state: page.state,
      more: page.more,
      refresh: page.refresh,
      setText(value: string) {
        if (value === text) return Promise.resolve()
        text = value
        return page.refresh()
      },
      close() {
        searches.delete(page)
        page.dispose()
      }
    }
  }

  function resolve(
    kind: 'task' | 'type',
    id: string,
    force = false
  ): Promise<void> {
    if (!id) return Promise.resolve()
    const key = kind + ':' + id
    wanted.set(key, { kind, id })
    if (
      !force &&
      !outdated.has(key) &&
      (kind === 'task' ? taskLabels.has(id) : typeLabels.has(id))
    ) {
      return Promise.resolve()
    }
    if (!force && unavailable.has(key)) {
      return Promise.reject(
        new Error('Definition is unavailable. Refresh to retry.')
      )
    }
    const existing = lookups.get(key)
    if (existing) return existing
    const current = generation
    const controller = new AbortController()
    controllers.add(controller)
    const request = (async () => {
      if (kind === 'task') {
        const item = await api.task(id, controller.signal)
        if (current === generation) {
          if (item.id !== id) throw new Error('Task identity changed.')
          remember(taskLabels, item, 'task')
        }
      } else {
        const item = await api.type(id, controller.signal)
        if (current === generation) {
          if (item.id !== id) throw new Error('Type identity changed.')
          remember(typeLabels, item, 'type')
        }
      }
    })()
      .catch(error => {
        if (current === generation) unavailable.add(key)
        throw error
      })
      .finally(() => {
        controllers.delete(controller)
        if (lookups.get(key) === request) lookups.delete(key)
      })
    lookups.set(key, request)
    return request
  }

  function resolveMany(
    values: { kind: 'task' | 'type'; id: string }[],
    force = false
  ) {
    const current = generation
    const run = async () => {
      for (
        let index = 0;
        index < values.length;
        index += DEFINITION_LOOKUP_CONCURRENCY
      ) {
        if (current !== generation) return
        await Promise.allSettled(
          values
            .slice(index, index + DEFINITION_LOOKUP_CONCURRENCY)
            .map(item => resolve(item.kind, item.id, force))
        )
      }
    }
    const next = batch.then(run, run)
    batch = next
    return next
  }
  function resolveCatalog(
    items: readonly Pick<ArtifactSearchItem, 'typeId' | 'taskIds'>[]
  ) {
    const needed = new Map<string, { kind: 'task' | 'type'; id: string }>()
    for (const item of items) {
      if (
        (!typeLabels.has(item.typeId) || outdated.has('type:' + item.typeId)) &&
        !unavailable.has('type:' + item.typeId)
      ) {
        needed.set('type:' + item.typeId, { kind: 'type', id: item.typeId })
      }
      for (const id of item.taskIds) {
        if (
          (!taskLabels.has(id) || outdated.has('task:' + id)) &&
          !unavailable.has('task:' + id)
        ) {
          needed.set('task:' + id, { kind: 'task', id })
        }
      }
    }
    return resolveMany([...needed.values()])
  }

  async function invalidate() {
    ++generation
    for (const controller of controllers) controller.abort()
    controllers.clear()
    lookups.clear()
    unavailable.clear()
    for (const id of taskLabels.keys()) outdated.add('task:' + id)
    for (const id of typeLabels.keys()) outdated.add('type:' + id)
    const requested = [...wanted.values()]
    await Promise.all([
      tasks.invalidate(),
      types.invalidate(),
      ...[...searches].map(page => page.invalidate())
    ])
    if (owners) {
      await resolveMany(
        requested.filter(
          item =>
            outdated.has(item.kind + ':' + item.id) ||
            !(item.kind === 'task' ? taskLabels : typeLabels).has(item.id)
        ),
        true
      )
    }
  }
  function retain() {
    ++owners
    if (owners === 1) {
      unsubscribe = subscribe?.(() => {
        void invalidate()
      })
      void invalidate()
      void tasks.setActive(true)
      void types.setActive(true)
    }
    let released = false
    return () => {
      if (released) return
      released = true
      --owners
      if (!owners) {
        unsubscribe?.()
        unsubscribe = undefined
        ++generation
        for (const controller of controllers) controller.abort()
        controllers.clear()
        lookups.clear()
        wanted.clear()
        unavailable.clear()
        void tasks.setActive(false)
        void types.setActive(false)
      }
    }
  }
  return {
    storeId,
    tasks,
    types,
    taskLabels,
    typeLabels,
    resolve,
    resolveCatalog,
    openSearch,
    invalidate,
    retain
  }
}

export const useArtifactDefinitionsStore = defineStore(
  'artifact-definitions',
  () => {
    const stores = new Map<
      string,
      ReturnType<typeof createArtifactDefinitions>
    >()
    let currentId: string | null = null
    let discovery: Promise<
      ReturnType<typeof createArtifactDefinitions>
    > | null = null
    function forStore(storeId: string, initialTasks?: TaskList) {
      currentId = storeId
      let value = stores.get(storeId)
      if (!value) {
        value = createArtifactDefinitions(
          storeId,
          invalidate => {
            const events = useServerEvents(['artifacts:changed'], invalidate)
            return events.close
          },
          initialTasks
        )
        stores.set(storeId, value)
      }
      return value
    }
    function current() {
      if (currentId) return Promise.resolve(forStore(currentId))
      discovery ??= api
        .tasks()
        .then(page => forStore(page.storeId, page))
        .finally(() => {
          discovery = null
        })
      return discovery
    }
    return { forStore, current }
  }
)
