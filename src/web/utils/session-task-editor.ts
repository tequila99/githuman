import { shallowReactive } from 'vue'
import { sessionTasksApi as api } from '@/api/session-tasks'
import type { SessionTaskAssignment } from '@/api/types'
import { ApiRequestError } from '@/api/client'
import { singleFlight } from '@/utils/single-flight'
import { errorMessage } from '@/utils/error-message'
import { requestAttempt, type RequestAttempt } from '@/utils/request-attempt'

export function createSessionTaskEditor(sessionId: string) {
  const state = shallowReactive<{
    snapshot: SessionTaskAssignment | null
    base: SessionTaskAssignment | null
    taskIds: string[]
    dirty: boolean
    loading: boolean
    busy: boolean
    changed: boolean
    conflict: boolean
    error: string | null
    attempt: RequestAttempt | null
  }>({
    snapshot: null,
    base: null,
    taskIds: [],
    dirty: false,
    loading: false,
    busy: false,
    changed: false,
    conflict: false,
    error: null,
    attempt: null
  })
  let disposed = false
  let generation = 0
  let controller: AbortController | null = null
  function accept(value: SessionTaskAssignment) {
    if (value.sessionId !== sessionId) {
      throw new Error('Task assignment belongs to another session.')
    }
    return value
  }
  function reset(value: SessionTaskAssignment) {
    state.base = value
    state.taskIds = [...value.taskIds]
    state.dirty = false
    state.changed = false
    state.conflict = false
    state.attempt = null
  }
  const refresh = singleFlight(async () => {
    if (disposed) return
    const current = ++generation
    controller?.abort()
    controller = new AbortController()
    state.loading = true
    try {
      const value = accept(await api.get(sessionId, controller.signal))
      if (disposed || current !== generation) return
      if (state.snapshot && value.version < state.snapshot.version) return
      state.snapshot = value
      state.changed =
        state.base !== null && value.version !== state.base.version
      if (!state.dirty && !state.busy) reset(value)
      if (!state.dirty) state.error = null
    } catch (error) {
      if (!disposed && current === generation) state.error = errorMessage(error)
    } finally {
      if (current === generation) state.loading = false
    }
  })
  function setTasks(ids: string[]) {
    if (state.busy || !state.base) return
    state.taskIds = [...new Set(ids)].sort()
    state.dirty = true
    state.attempt = null
  }
  async function reload() {
    if (state.busy) return
    await refresh()
    if (state.snapshot && !state.error) reset(state.snapshot)
  }
  async function save() {
    if (
      disposed ||
      state.busy ||
      state.loading ||
      !state.base ||
      !state.dirty ||
      state.conflict
    ) {
      return
    }
    if (state.changed && !state.attempt) {
      throw new Error('Assignment changed. Reload before saving.')
    }
    const taskIds = [...state.taskIds].sort()
    const expectedVersion = state.base.version
    state.attempt = requestAttempt(state.attempt, {
      sessionId,
      expectedVersion,
      taskIds
    })
    state.busy = true
    state.error = null
    try {
      const value = accept(
        await api.assign(sessionId, {
          requestId: state.attempt.requestId,
          expectedVersion,
          taskIds
        })
      )
      if (disposed) return
      if (
        value.version !== expectedVersion + 1 ||
        JSON.stringify([...value.taskIds].sort()) !== JSON.stringify(taskIds)
      ) {
        throw new Error(
          'Saved task assignment does not match the requested scope.'
        )
      }
      ++generation
      controller?.abort()
      state.loading = false
      state.snapshot = value
      reset(value)
    } catch (error) {
      if (!disposed) {
        state.error = errorMessage(error)
        state.conflict =
          error instanceof ApiRequestError && error.status === 409
      }
      throw error
    } finally {
      state.busy = false
    }
  }
  function pause() {
    ++generation
    controller?.abort()
    state.loading = false
  }
  function dispose() {
    disposed = true
    pause()
  }
  return { state, setTasks, refresh, reload, save, pause, dispose }
}
