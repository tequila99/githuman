import { shallowReactive, shallowRef, ref } from 'vue'
import { defineStore } from 'pinia'
import { artifactActionsApi as api } from '@/api/artifact-actions'
import { ApiRequestError } from '@/api/client'
import { singleFlight } from '@/utils/single-flight'
import { errorMessage } from '@/utils/error-message'
import { requestAttempt, type RequestAttempt } from '@/utils/request-attempt'
import type {
  ArtifactActionInspection,
  ArtifactActionList,
  ArtifactActionListItem
} from '@/api/types'

/** Outcome of the selected action that the pending list can no longer show. */
export type ArtifactActionOutcome = 'granted' | 'applied' | 'revoked' | null

export function createArtifactActions(
  storeId: string,
  now: () => number = Date.now
) {
  const state = shallowReactive<{
    items: ArtifactActionListItem[]
    selectedId: string | null
    inspection: ArtifactActionInspection | null
    loading: boolean
    listLoading: boolean
    stale: boolean
    busy: boolean
    error: string | null
    listError: string | null
    // The grant exists, but reading the result back failed.
    refreshError: string | null
    confirmed: boolean
    outcome: ArtifactActionOutcome
    // The selected action ended: expired, revoked by a session close, or lost on restart.
    unavailable: boolean
    expired: boolean
  }>({
    items: [],
    selectedId: null,
    inspection: null,
    loading: false,
    listLoading: false,
    stale: true,
    busy: false,
    error: null,
    listError: null,
    refreshError: null,
    confirmed: false,
    outcome: null,
    unavailable: false,
    expired: false
  })
  const approvals = new Map<string, RequestAttempt>()
  const commits = new Map<string, RequestAttempt>()
  // Counts start/stop cycles: an answer from an older cycle never lands.
  let lifetime = 0
  let generation = 0
  let listGeneration = 0
  let active = true
  let controller: AbortController | null = null
  let listController: AbortController | null = null
  // The server announces a revoke before it answers the request: reading the request then fails with 404.
  let revoking: string | null = null

  function reset() {
    state.confirmed = false
    state.stale = true
  }
  const refresh = singleFlight(async () => {
    const id = state.selectedId
    if (!active || !id || id === revoking || state.outcome === 'revoked') return
    const current = ++generation
    const cycle = lifetime
    controller?.abort()
    const request = new AbortController()
    controller = request
    state.loading = true
    state.error = null
    try {
      const result = await api.inspect(id, request.signal)
      if (!active || current !== generation || cycle !== lifetime) return
      if (result.storeId !== storeId || result.pending.id !== id) {
        throw new Error('Action inspection identity changed.')
      }
      const before = state.inspection
      if (!before || JSON.stringify(before) !== JSON.stringify(result)) {
        state.confirmed = false
      }
      state.inspection = result
      state.unavailable = false
      state.stale = false
      state.expired = result.pending.expiresAt <= now()
    } catch (error) {
      if (active && current === generation && cycle === lifetime) {
        // A missing action is final; a transport failure may recover on retry.
        if (error instanceof ApiRequestError && error.status === 404) {
          state.unavailable = true
        }
        state.error = errorMessage(error)
        reset()
      }
    } finally {
      if (current === generation) state.loading = false
    }
  })
  function applyList(result: ArtifactActionList) {
    if (result.storeId !== storeId) {
      throw new Error('Actions belong to another artifact store.')
    }
    if (
      state.inspection?.phase === 'pending' &&
      !result.items.some(item => item.id === state.selectedId)
    ) {
      reset()
      void refresh()
    }
    state.items = result.items
    state.listError = null
  }
  const list = singleFlight(async () => {
    if (!active) return
    const current = ++listGeneration
    const cycle = lifetime
    listController?.abort()
    const request = new AbortController()
    listController = request
    state.listLoading = true
    try {
      const result = await api.list(request.signal)
      if (!active || current !== listGeneration || cycle !== lifetime) return
      applyList(result)
    } catch (error) {
      if (active && current === listGeneration && cycle === lifetime) {
        state.listError = errorMessage(error)
      }
    } finally {
      if (current === listGeneration) state.listLoading = false
    }
  })
  function select(id: string | null) {
    ++generation
    controller?.abort()
    state.selectedId = id
    state.inspection = null
    state.outcome = null
    state.unavailable = false
    state.expired = false
    state.error = null
    state.refreshError = null
    state.confirmed = false
    state.stale = true
    state.loading = false
    return id ? refresh() : Promise.resolve()
  }
  function invalidate() {
    ++generation
    controller?.abort()
    reset()
    return Promise.all([list(), refresh()])
  }
  /** The nearest expiry of the queue or the selected action, for one timer. */
  function nextExpiry(): number | null {
    const times = state.items.map(item => item.expiresAt)
    if (state.inspection) times.push(state.inspection.pending.expiresAt)
    return times.length ? Math.min(...times) : null
  }
  /** Drops confirmation at once when the selected scope has expired. */
  function expire() {
    const value = state.inspection
    if (value && value.pending.expiresAt <= now()) {
      state.expired = true
      reset()
    }
  }
  /** The checkbox of the shown scope; the dialog never writes the state itself. */
  function confirm(value: boolean) {
    state.confirmed = value
  }
  function checkedInspection(phase: 'pending' | 'authorized') {
    const value = state.inspection
    if (
      !value ||
      state.stale ||
      state.loading ||
      !value.ready ||
      value.phase !== phase ||
      value.pending.expiresAt <= now()
    ) {
      throw new Error(
        'The action is stale, expired or blocked. Refresh its scope.'
      )
    }
    return value
  }
  async function approve() {
    if (state.busy) return
    const value = checkedInspection('pending')
    if (!state.confirmed) {
      throw new Error('Review and explicitly confirm this exact scope.')
    }
    const id = value.pending.id
    const cycle = lifetime
    const attempt = requestAttempt(approvals.get(id) ?? null, value.pending)
    approvals.set(id, attempt)
    state.busy = true
    state.error = null
    state.refreshError = null
    try {
      await api.approve(id, attempt.requestId)
    } catch (error) {
      // The answer may be lost after the server wrote the grant: the phase decides.
      if (cycle === lifetime && state.selectedId === id) {
        state.error = errorMessage(error)
        reset()
      }
      state.busy = false
      throw error
    }
    try {
      if (cycle === lifetime && state.selectedId === id) {
        state.outcome = 'granted'
        reset()
      }
      await Promise.all([list(), refresh()])
      // refresh keeps its failure in `error`; the grant exists, so move it aside.
      if (state.error) {
        state.refreshError = state.error
        state.error = null
      }
    } catch (error) {
      // The grant exists. Do not present this as a failed approval.
      state.refreshError = errorMessage(error)
    } finally {
      state.busy = false
    }
  }
  async function execute() {
    if (state.busy) return
    const value = checkedInspection('authorized')
    if (!value.canExecute || !value.authorizationId) {
      throw new Error('Only the requesting session can apply this action.')
    }
    const id = value.pending.id
    const cycle = lifetime
    const action = value.pending.action
    const attempt = requestAttempt(commits.get(id) ?? null, {
      action,
      authorizationId: value.authorizationId
    })
    commits.set(id, attempt)
    state.busy = true
    state.error = null
    try {
      await api.commit(action.changeSetId, {
        version: action.version,
        validationId: action.validationId,
        authorizationId: value.authorizationId,
        requestId: attempt.requestId
      })
      // The server consumed the grant: the user keeps seeing the result even
      // when reading the action back fails.
      if (cycle === lifetime && state.selectedId === id) {
        state.outcome = 'applied'
      }
      await Promise.all([list(), refresh()])
    } catch (error) {
      state.error = errorMessage(error)
      reset()
      throw error
    } finally {
      state.busy = false
    }
  }
  async function revoke() {
    const id = state.selectedId
    if (!id || state.busy) return
    const cycle = lifetime
    state.busy = true
    state.error = null
    revoking = id
    try {
      await api.revoke(id)
      if (cycle === lifetime && state.selectedId === id) {
        // Keep the card: the user sees the end result and leaves by choice.
        state.outcome = 'revoked'
        state.confirmed = false
        state.stale = true
        state.inspection = null
      }
      await list()
    } catch (error) {
      state.error = errorMessage(error)
      throw error
    } finally {
      revoking = null
      state.busy = false
    }
  }
  /** Takes the list that the bootstrap already read, or reads it again. */
  function start(initial?: ArtifactActionList) {
    ++lifetime
    active = true
    if (initial) {
      try {
        applyList(initial)
      } catch (error) {
        state.listError = errorMessage(error)
      }
      return Promise.resolve()
    }
    return list()
  }
  function stop() {
    ++lifetime
    active = false
    ++generation
    ++listGeneration
    controller?.abort()
    listController?.abort()
    reset()
    state.loading = false
    state.listLoading = false
  }
  return {
    state,
    list,
    refresh,
    select,
    invalidate,
    nextExpiry,
    expire,
    confirm,
    approve,
    execute,
    revoke,
    start,
    stop
  }
}

export type ArtifactActionsModel = ReturnType<typeof createArtifactActions>

export const useArtifactActionsStore = defineStore('artifact-actions', () => {
  const stores = new Map<string, ArtifactActionsModel>()
  // The store identity comes from the server answer, not from the catalog page.
  const model = shallowRef<ArtifactActionsModel | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  function forStore(storeId: string) {
    let result = stores.get(storeId)
    if (!result) {
      result = createArtifactActions(storeId)
      stores.set(storeId, result)
    }
    return result
  }
  function release(keep: string | null) {
    for (const [id, value] of stores) {
      if (id === keep) continue
      value.stop()
      stores.delete(id)
    }
  }
  const bootstrap = singleFlight(async () => {
    loading.value = true
    error.value = null
    try {
      const result = await api.list()
      release(result.storeId)
      const next = forStore(result.storeId)
      model.value = next
      await next.start(result)
    } catch (cause) {
      error.value = errorMessage(cause)
    } finally {
      loading.value = false
    }
  })
  function dispose() {
    release(null)
    model.value = null
  }
  return { model, loading, error, forStore, bootstrap, dispose }
})
