import { computed, onScopeDispose, reactive, shallowRef, watch } from 'vue'
import { taskJournalApi } from '@/api/task-journal'
import { useServerEvents } from '@/composables/use-server-events'
import { usePaneVisibility } from '@/composables/use-pane-visibility'
import { singleFlight } from '@/utils/single-flight'
import { requestAttempt, type RequestAttempt } from '@/utils/request-attempt'
import { errorMessage } from '@/utils/error-message'
import type { JournalAppend, JournalEntry } from '@/api/types'

export function useTaskJournal(props: {
  taskId: string
  storeId: string
  active: boolean
}) {
  const paneVisible = usePaneVisibility()
  const items = shallowRef<JournalEntry[]>([])
  const nextBefore = shallowRef<number | null>(null)
  const through = shallowRef<number | undefined>()
  const error = shallowRef<string | null>(null)
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const drafts = reactive<
    Record<
      string,
      {
        body: string
        kind: JournalAppend['kind']
        supersedesEntryId?: string | undefined
        attempt: RequestAttempt | null
      }
    >
  >({})
  const key = computed(() => `${props.storeId}:${props.taskId}`)
  const draft = computed(
    () => (drafts[key.value] ??= { body: '', kind: 'note', attempt: null })
  )
  let generation = 0
  let disposed = false
  const visible = computed(() => props.active && paneVisible())
  const refresh = singleFlight(async () => {
    if (!visible.value || disposed) return
    const mine = generation
    loading.value = true
    try {
      const taskId = props.taskId
      const storeId = props.storeId
      const previousNewest = items.value[0]?.seq
      const page = await taskJournalApi.list(taskId, storeId)
      const fresh = [...page.items]
      let next = page.nextBeforeSeq
      // Bridge all newly appended pages before merging the old, continuous window.
      if (previousNewest !== undefined) {
        while (next !== null && fresh.at(-1)!.seq > previousNewest) {
          const following = await taskJournalApi.list(
            taskId,
            storeId,
            next,
            page.throughSeq
          )
          if (mine !== generation || disposed) return
          fresh.push(...following.items)
          next = following.nextBeforeSeq
        }
      }
      if (mine !== generation || disposed) return
      // Keep already loaded older pages when a new entry arrives.
      items.value = [
        ...new Map(
          [...fresh, ...items.value].map(entry => [entry.id, entry])
        ).values()
      ].sort((a, b) => b.seq - a.seq)
      if (previousNewest === undefined) nextBefore.value = next
      through.value = page.throughSeq
      error.value = null
    } catch (cause) {
      if (mine === generation && !disposed) error.value = errorMessage(cause)
    } finally {
      if (mine === generation && !disposed) loading.value = false
    }
  })
  async function older() {
    if (nextBefore.value === null || loading.value) return
    const mine = generation
    loading.value = true
    try {
      const page = await taskJournalApi.list(
        props.taskId,
        props.storeId,
        nextBefore.value,
        through.value
      )
      if (mine !== generation || disposed) return
      items.value = [
        ...new Map(
          [...items.value, ...page.items].map(entry => [entry.id, entry])
        ).values()
      ].sort((a, b) => b.seq - a.seq)
      nextBefore.value = page.nextBeforeSeq
      error.value = null
    } catch (cause) {
      if (mine === generation && !disposed) error.value = errorMessage(cause)
    } finally {
      if (mine === generation && !disposed) loading.value = false
    }
  }
  async function append() {
    if (saving.value || !draft.value.body.trim()) return
    const mine = generation
    const current = draft.value
    const { body, kind, supersedesEntryId } = current
    const input = {
      body,
      kind,
      ...(supersedesEntryId ? { supersedesEntryId } : {})
    }
    current.attempt = requestAttempt(current.attempt, {
      storeId: props.storeId,
      taskId: props.taskId,
      ...input
    })
    saving.value = true
    try {
      await taskJournalApi.append(props.taskId, props.storeId, {
        ...input,
        requestId: current.attempt.requestId
      })
      if (
        current.body === body &&
        current.kind === kind &&
        current.supersedesEntryId === supersedesEntryId
      ) {
        current.body = ''
        current.supersedesEntryId = undefined
        current.attempt = null
      }
      if (mine === generation && !disposed) {
        error.value = null
        await refresh()
      }
    } catch (cause) {
      if (mine === generation && !disposed) error.value = errorMessage(cause)
    } finally {
      saving.value = false
    }
  }
  function correct(entry: JournalEntry) {
    draft.value.supersedesEntryId = entry.id
    draft.value.body = entry.body
    draft.value.kind = entry.kind === 'system' ? 'note' : entry.kind
  }
  watch(
    key,
    () => {
      generation++
      items.value = []
      through.value = undefined
      nextBefore.value = null
      error.value = null
      loading.value = false
      void refresh()
    },
    { immediate: true }
  )
  watch(visible, value => {
    if (value) void refresh()
  })
  const events = useServerEvents(['task-journal:changed'], () => {
    void refresh()
  })
  onScopeDispose(() => {
    disposed = true
    generation++
    events.close()
  })
  return {
    items,
    nextBefore,
    error,
    loading,
    saving,
    draft,
    refresh,
    older,
    append,
    correct
  }
}
