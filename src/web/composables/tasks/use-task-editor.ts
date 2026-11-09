import {
  onBeforeUnmount,
  shallowReactive,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter
} from 'vue'
import { debounce } from 'quasar'
import { ARTIFACT_ERROR_CODES } from '../../../shared/artifacts/error-codes.ts'
import { ApiRequestError } from '@/api/client'
import { tasksApi } from '@/api/tasks'
import type { Task, TaskInput, TaskLink } from '@/api/types'
import { useServerEvents } from '@/composables/use-server-events'
import { useTasksStore } from '@/stores/tasks-store'
import { errorMessage } from '@/utils/error-message'
import { requestAttempt, type RequestAttempt } from '@/utils/request-attempt'

// Typing pauses this long before the draft is saved.
const AUTOSAVE_DELAY_MS = 800
const CONFLICT_STATUS = 409

export type TaskEditStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'

interface TaskDraft {
  title: string
  description: string
  links: TaskLink[]
  tags: string[]
}

function draftOf(task: Task): TaskDraft {
  return {
    title: task.title,
    description: task.description,
    links: task.links.map(link => ({ ...link })),
    tags: [...task.tags]
  }
}

// Blank link rows stay in the form while the user types; the server never sees them.
function inputOf(draft: TaskDraft): TaskInput {
  return {
    title: draft.title.trim(),
    state: 'open',
    description: draft.description,
    tags: [...draft.tags],
    links: draft.links
      .filter(link => link.url.trim())
      .map(link => ({
        url: link.url.trim(),
        ...(link.label?.trim() ? { label: link.label.trim() } : {})
      }))
  }
}

// Active artifacts only block the close; any other 409 means the task changed elsewhere.
function closeFailureStatus(err: unknown): TaskEditStatus {
  if (!(err instanceof ApiRequestError) || err.status !== CONFLICT_STATUS) {
    return 'error'
  }
  return err.code === ARTIFACT_ERROR_CODES.taskHasActiveArtifacts
    ? 'saved'
    : 'conflict'
}

/** Loads one task and saves edits with a version check; a conflict keeps the draft. */
export function useTaskEditor(id: MaybeRefOrGetter<string | null>) {
  const tasks = useTasksStore()
  const task = shallowRef<Task | null>(null)
  const draft = shallowReactive<TaskDraft>({
    title: '',
    description: '',
    links: [],
    tags: []
  })
  const status = shallowRef<TaskEditStatus>('saved')
  const error = shallowRef<string | null>(null)
  const loading = shallowRef(false)
  // Changes when the draft is replaced from the server, so the editor remounts.
  const revision = shallowRef(0)
  let attempt: RequestAttempt | null = null
  let saving: Promise<void> | null = null
  let loadGeneration = 0
  // Edits are refused while the close request runs; they would hit a closed task.
  let closing = false

  function adopt(next: Task) {
    task.value = next
    Object.assign(draft, draftOf(next))
    revision.value++
    status.value = 'saved'
    error.value = null
    attempt = null
  }

  async function load() {
    const current = toValue(id)
    const mine = ++loadGeneration
    task.value = null
    if (!current) return
    loading.value = true
    try {
      const loaded = await tasksApi.get(current)
      if (mine === loadGeneration) adopt(loaded)
    } catch (err) {
      if (mine === loadGeneration) {
        error.value = errorMessage(err)
        status.value = 'error'
      }
    } finally {
      if (mine === loadGeneration) loading.value = false
    }
  }

  // Reads a newer server version only while nothing local is waiting to be saved.
  async function refreshQuietly() {
    const current = toValue(id)
    if (!current || status.value !== 'saved' || !task.value) return
    try {
      const loaded = await tasksApi.get(current)
      if (
        status.value === 'saved' &&
        current === toValue(id) &&
        loaded.version > (task.value?.version ?? 0)
      ) {
        adopt(loaded)
      }
    } catch {
      // The next event or action shows a real error.
    }
  }

  async function runSave() {
    const current = task.value
    // Nothing to send while the draft equals the saved task.
    if (!current || status.value === 'conflict' || status.value === 'saved') {
      return
    }
    const input = inputOf(draft)
    if (!input.title) {
      status.value = 'error'
      error.value = 'empty-title'
      return
    }
    const sent = JSON.stringify(input)
    attempt = requestAttempt(attempt, {
      id: current.id,
      version: current.version,
      input
    })
    status.value = 'saving'
    try {
      const saved = await tasksApi.update(
        current.id,
        current.version,
        input,
        attempt.requestId
      )
      attempt = null
      if (current.id !== task.value?.id) return
      task.value = saved
      tasks.remember(saved)
      error.value = null
      // Text typed during the request waits for its own save.
      status.value = JSON.stringify(inputOf(draft)) === sent ? 'saved' : 'dirty'
      if (status.value === 'dirty') scheduleSave()
    } catch (err) {
      if (current.id !== task.value?.id) return
      if (err instanceof ApiRequestError && err.status === CONFLICT_STATUS) {
        status.value = 'conflict'
      } else {
        status.value = 'error'
      }
      error.value = errorMessage(err)
    }
  }

  function save(): Promise<void> {
    cancelScheduledSave()
    saving ??= runSave().finally(() => {
      saving = null
    })
    return saving
  }
  const autosave = debounce(() => void save(), AUTOSAVE_DELAY_MS)
  function scheduleSave() {
    autosave()
  }
  function cancelScheduledSave() {
    autosave.cancel()
  }

  function edit(patch: Partial<TaskDraft>) {
    if (!task.value || task.value.state === 'closed' || closing) return
    if (status.value === 'conflict') return
    Object.assign(draft, patch)
    status.value = 'dirty'
    error.value = null
    scheduleSave()
  }

  /** Saves pending edits, then closes the task. The server checks the artifacts. */
  async function close(): Promise<boolean> {
    closing = true
    try {
      await save()
      const current = task.value
      if (!current || status.value !== 'saved') return false
      const input = { ...inputOf(draft), state: 'closed' as const }
      attempt = requestAttempt(attempt, {
        id: current.id,
        version: current.version,
        input
      })
      try {
        const closed = await tasksApi.update(
          current.id,
          current.version,
          input,
          attempt.requestId
        )
        attempt = null
        task.value = closed
        tasks.remember(closed)
        error.value = null
        return true
      } catch (err) {
        error.value = errorMessage(err)
        status.value = closeFailureStatus(err)
        return false
      }
    } finally {
      closing = false
    }
  }

  // Edits to the old task are saved before the next one replaces the form.
  watch(
    () => toValue(id),
    async () => {
      if (status.value === 'dirty') await save()
      await load()
    },
    { immediate: true }
  )
  const events = useServerEvents(['artifacts:changed'], () => {
    void refreshQuietly()
  })
  onBeforeUnmount(() => {
    events.close()
    cancelScheduledSave()
    void flushPending()
  })
  // A save still in flight owns the current version; the last edits follow it.
  async function flushPending() {
    await saving
    if (status.value === 'dirty') await runSave()
    cancelScheduledSave()
  }

  return {
    task,
    draft,
    status,
    error,
    loading,
    revision,
    load,
    edit,
    save,
    close
  }
}
