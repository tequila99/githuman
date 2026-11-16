import { onScopeDispose, shallowRef } from 'vue'
import { useInterval } from 'quasar'
import { ApiRequestError } from '@/api/client'
import { taskJournalApi } from '@/api/task-journal'
import { tasksApi } from '@/api/tasks'
import { sessionTasksApi } from '@/api/session-tasks'
import { requestAttempt, type RequestAttempt } from '@/utils/request-attempt'
import { errorMessage } from '@/utils/error-message'
import type { Handoff } from '@/api/types'

// Poll only while a confirmed operation waits for its agent handshake.
const HANDOFF_POLL_MS = 700
// Server code of a full chat list; the dialog asks the user to close a chat.
const SESSION_LIMIT_CODE = 'GHT_AGENT_SESSION_LIMIT'

/**
 * A 4xx answer is a definite refusal; the preview is unchanged.
 * Any other failure can hide an accepted confirm, so the operation is polled.
 */
function uncertain(cause: unknown): boolean {
  return !(cause instanceof ApiRequestError) || cause.status >= 500
}

/** State of one handoff dialog: preview, confirm and recovery after a lost response. */
export function useTaskHandoff(options: {
  taskId?: () => string
  sourceSessionId: () => string | undefined
  onReady: (targetSessionId: string) => Promise<void> | void
}) {
  const busy = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const slotsFull = shallowRef(false)
  const operation = shallowRef<Handoff | null>(null)
  let attempt: RequestAttempt | null = null
  let disposed = false
  const { registerInterval, removeInterval } = useInterval()
  onScopeDispose(() => {
    disposed = true
    removeInterval()
  })
  function fail(cause: unknown) {
    error.value = errorMessage(cause)
    slotsFull.value =
      cause instanceof ApiRequestError && cause.code === SESSION_LIMIT_CODE
  }
  function clearError() {
    error.value = null
    slotsFull.value = false
  }
  async function preview(presetId: string, name?: string) {
    busy.value = true
    clearError()
    try {
      const taskId = options.taskId?.()
      const sourceId = options.sourceSessionId()
      if (!taskId && !sourceId) {
        throw new Error('A task or a source session is required.')
      }
      const task = taskId ? await tasksApi.get(taskId) : await tasksApi.list({})
      const source = sourceId ? await sessionTasksApi.get(sourceId) : null
      const storeId = task.storeId
      if (!storeId) throw new Error('A source session is required.')
      const input = {
        storeId,
        presetId,
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(source
          ? {
              sourceSessionId: source.sessionId,
              sourceAssignmentVersion: source.version
            }
          : {})
      }
      attempt = requestAttempt(attempt, { taskId, ...input })
      const request = { ...input, requestId: attempt.requestId }
      const captured = taskId
        ? await taskJournalApi.preview(taskId, request)
        : await taskJournalApi.previewSession({
            ...request,
            sourceSessionId: source!.sessionId,
            sourceAssignmentVersion: source!.version
          })
      if (disposed) return undefined
      operation.value = captured
      return captured
    } catch (cause) {
      if (!disposed) fail(cause)
    } finally {
      busy.value = false
    }
    return undefined
  }
  async function poll() {
    const current = operation.value
    if (!current || busy.value || disposed) return
    busy.value = true
    try {
      const value = await taskJournalApi.handoff(current.id)
      if (disposed || operation.value?.id !== current.id) return
      operation.value = value
      if (value.state === 'ready' && value.targetSessionId) {
        removeInterval()
        clearError()
        await options.onReady(value.targetSessionId)
      } else if (value.state !== 'preparing') {
        removeInterval()
        // A preview means the confirm was not accepted: keep its explanation.
        if (value.state !== 'preview') error.value = value.error
      }
    } catch (cause) {
      if (!disposed) fail(cause)
    } finally {
      busy.value = false
    }
  }
  function startPolling() {
    registerInterval(() => {
      void poll()
    }, HANDOFF_POLL_MS)
  }
  async function confirm() {
    const current = operation.value
    if (!current) return
    busy.value = true
    clearError()
    let reconcile = false
    try {
      const value = await taskJournalApi.confirm(current.id, current.digest)
      if (disposed) return
      operation.value = value
      reconcile = value.state === 'preparing'
      if (value.state === 'ready' && value.targetSessionId) {
        await options.onReady(value.targetSessionId)
      } else if (value.state === 'failed' || value.state === 'interrupted') {
        error.value = value.error
      }
    } catch (cause) {
      if (disposed) return
      fail(cause)
      // A lost confirm response must reconcile this operation, not create another chat.
      reconcile = uncertain(cause)
    } finally {
      busy.value = false
    }
    if (reconcile && !disposed) startPolling()
  }
  async function continueWithoutPreview(presetId: string, name?: string) {
    if (busy.value || operation.value || disposed) return
    const captured = await preview(presetId, name)
    if (!disposed && captured?.state === 'preview') {
      await confirm()
    }
  }
  /** Starts a new preview; the old one expires and reserves nothing. */
  function reset() {
    removeInterval()
    operation.value = null
    attempt = null
    clearError()
  }
  return {
    busy,
    error,
    slotsFull,
    operation,
    preview,
    confirm,
    continueWithoutPreview,
    poll,
    reset,
    stop: removeInterval
  }
}
