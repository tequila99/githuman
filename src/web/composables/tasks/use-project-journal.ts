import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import type { JournalSearchEntry, JournalSearchInput } from '@/api/types'
import { taskJournalApi } from '@/api/task-journal'
import { useServerEvents } from '@/composables/use-server-events'
import { errorMessage } from '@/utils/error-message'

export function useProjectJournal(
  input: () => JournalSearchInput,
  visible: () => boolean
) {
  const items = shallowRef<JournalSearchEntry[]>([])
  const agentNames = shallowRef<string[]>([])
  const models = shallowRef<string[]>([])
  const storeId = shallowRef<string | null>(null)
  const nextBefore = shallowRef<number | null>(null)
  const loading = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const hasUpdates = shallowRef(false)
  const loaded = shallowRef(false)
  let through: number | undefined
  let generation = 0
  let invalidation = 0
  let controller: AbortController | undefined
  let disposed = false
  let retryOlder = false
  const key = computed(() => JSON.stringify(input()))

  async function load(older: boolean) {
    if (
      disposed ||
      !visible() ||
      (older && (loading.value || nextBefore.value === null))
    ) {
      return
    }
    retryOlder = older
    const mine = ++generation
    const covered = invalidation
    controller?.abort()
    const request = new AbortController()
    controller = request
    const query = {
      ...input(),
      ...(storeId.value ? { storeId: storeId.value } : {})
    }
    if (older) {
      query.beforeSeq = nextBefore.value!
      if (through !== undefined) query.throughSeq = through
    }
    loading.value = true
    error.value = null
    try {
      const page = await taskJournalApi.search(query, request.signal)
      if (disposed || mine !== generation) return
      if (query.storeId && page.storeId !== query.storeId) {
        throw new Error('Journal belongs to another project. Reload the page.')
      }
      items.value = older
        ? [
            ...new Map(
              [...items.value, ...page.items].map(entry => [entry.id, entry])
            ).values()
          ]
        : page.items
      agentNames.value = page.agentNames ?? []
      models.value = page.models ?? []
      storeId.value = page.storeId
      nextBefore.value = page.nextBeforeSeq
      through = page.throughSeq
      loaded.value = true
      if (!older) hasUpdates.value = covered !== invalidation
    } catch (cause) {
      if (!disposed && mine === generation) error.value = errorMessage(cause)
    } finally {
      if (!disposed && mine === generation) loading.value = false
    }
  }
  function reset() {
    generation++
    controller?.abort()
    items.value = []
    agentNames.value = []
    models.value = []
    nextBefore.value = null
    through = undefined
    loading.value = false
    loaded.value = false
    error.value = null
    // A changed explicit store must never inherit the old pagination identity.
    if (input().storeId && input().storeId !== storeId.value) {
      storeId.value = null
    }
    void load(false)
  }
  watch(key, reset, { immediate: true, flush: 'sync' })
  watch(visible, shown => {
    if (shown && !loaded.value && !loading.value) void load(false)
  })
  const events = useServerEvents(
    ['task-journal:changed', 'artifacts:changed'],
    () => {
      invalidation++
      hasUpdates.value = true
    }
  )
  onScopeDispose(() => {
    disposed = true
    generation++
    controller?.abort()
    events.close()
  })
  return {
    items,
    agentNames,
    models,
    storeId,
    nextBefore,
    loading,
    error,
    hasUpdates,
    loaded,
    refresh: () => load(false),
    older: () => load(true),
    retry: () => load(retryOlder)
  }
}
