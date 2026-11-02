import { shallowReactive } from 'vue'
import { defineStore } from 'pinia'
import { artifactActionsApi as api } from '@/api/artifact-actions'
import { singleFlight } from '@/utils/single-flight'
import { errorMessage } from '@/utils/error-message'
import { requestAttempt, type RequestAttempt } from '@/utils/request-attempt'
import type {
  ArtifactActionInspection,
  PendingArtifactAction
} from '@/api/types'

export function createArtifactActions(storeId: string) {
  const state = shallowReactive<{
    items: PendingArtifactAction[]
    selectedId: string | null
    inspection: ArtifactActionInspection | null
    loading: boolean
    listLoading: boolean
    stale: boolean
    busy: boolean
    error: string | null
    listError: string | null
    confirmed: boolean
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
    confirmed: false
  })
  const approvals = new Map<string, RequestAttempt>()
  const commits = new Map<string, RequestAttempt>()
  let generation = 0
  let active = true
  let controller: AbortController | null = null
  const refresh = singleFlight(async () => {
    const id = state.selectedId
    if (!active || !id) return
    const current = ++generation
    controller?.abort()
    const request = new AbortController()
    controller = request
    state.loading = true
    state.error = null
    try {
      const result = await api.inspect(id, request.signal)
      if (!active || current !== generation) return
      if (result.storeId !== storeId || result.pending.id !== id) {
        throw new Error('Action inspection identity changed.')
      }
      const before = state.inspection
      if (!before || JSON.stringify(before) !== JSON.stringify(result)) {
        state.confirmed = false
      }
      state.inspection = result
      state.stale = false
    } catch (error) {
      if (active && current === generation) {
        state.error = errorMessage(error)
        state.stale = true
        state.confirmed = false
      }
    } finally {
      if (current === generation) state.loading = false
    }
  })
  const list = singleFlight(async () => {
    if (!active) return
    state.listLoading = true
    try {
      const result = await api.list()
      if (!active) return
      if (result.storeId !== storeId) {
        throw new Error('Actions belong to another artifact store.')
      }
      if (
        state.inspection?.phase === 'pending' &&
        !result.items.some(item => item.id === state.selectedId)
      ) {
        state.stale = true
        state.confirmed = false
        void refresh()
      }
      state.items = result.items
      state.listError = null
    } catch (error) {
      if (active) state.listError = errorMessage(error)
    } finally {
      state.listLoading = false
    }
  })
  function select(id: string | null) {
    ++generation
    controller?.abort()
    state.selectedId = id
    state.inspection = null
    state.confirmed = false
    state.stale = true
    state.loading = false
    return id ? refresh() : Promise.resolve()
  }
  function invalidate() {
    ++generation
    controller?.abort()
    state.stale = true
    state.confirmed = false
    return Promise.all([list(), refresh()])
  }
  function checkedInspection(phase: 'pending' | 'authorized') {
    const value = state.inspection
    if (
      !value ||
      state.stale ||
      state.loading ||
      !value.ready ||
      value.phase !== phase ||
      value.pending.expiresAt <= Date.now()
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
    const attempt = requestAttempt(approvals.get(id) ?? null, value.pending)
    approvals.set(id, attempt)
    state.busy = true
    state.error = null
    try {
      await api.approve(id, attempt.requestId)
      await Promise.all([list(), refresh()])
    } catch (error) {
      state.error = errorMessage(error)
      state.stale = true
      state.confirmed = false
      throw error
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
      await Promise.all([list(), refresh()])
    } catch (error) {
      state.error = errorMessage(error)
      state.stale = true
      throw error
    } finally {
      state.busy = false
    }
  }
  async function revoke() {
    const id = state.selectedId
    if (!id || state.busy) return
    state.busy = true
    try {
      await api.revoke(id)
      await select(null)
      await list()
    } catch (error) {
      state.error = errorMessage(error)
      throw error
    } finally {
      state.busy = false
    }
  }
  function start() {
    active = true
    return list()
  }
  function stop() {
    active = false
    ++generation
    controller?.abort()
    state.stale = true
    state.confirmed = false
    state.loading = false
  }
  return {
    state,
    list,
    refresh,
    select,
    invalidate,
    approve,
    execute,
    revoke,
    start,
    stop
  }
}
export const useArtifactActionsStore = defineStore('artifact-actions', () => {
  const stores = new Map<string, ReturnType<typeof createArtifactActions>>()
  function forStore(storeId: string) {
    let result = stores.get(storeId)
    if (!result) {
      result = createArtifactActions(storeId)
      stores.set(storeId, result)
    }
    return result
  }
  return { forStore }
})
