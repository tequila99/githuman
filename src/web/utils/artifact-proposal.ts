import { shallowReactive } from 'vue'
import { artifactActionsApi as api } from '@/api/artifact-actions'
import { errorMessage } from '@/utils/error-message'
import { singleFlight } from '@/utils/single-flight'
import type {
  ArtifactStoredChangeSet,
  ArtifactChangeSetPreview,
  ArtifactValidationInspection
} from '@/api/types'

export function createArtifactProposal(storeId: string) {
  const state = shallowReactive<{
    changeSetId: string | null
    validationId: string | null
    proposal: ArtifactStoredChangeSet | null
    preview: ArtifactChangeSetPreview | null
    inspection: ArtifactValidationInspection | null
    loading: boolean
    busy: boolean
    stale: boolean
    error: string | null
  }>({
    changeSetId: null,
    validationId: null,
    proposal: null,
    preview: null,
    inspection: null,
    loading: false,
    busy: false,
    stale: true,
    error: null
  })
  let generation = 0
  let disposed = false
  let controller: AbortController | null = null
  const refresh = singleFlight(async () => {
    const id = state.changeSetId
    if (!id || disposed) return
    const current = ++generation
    controller?.abort()
    const readController = new AbortController()
    controller = readController
    state.loading = true
    state.error = null
    try {
      const [proposal, inspection] = await Promise.all([
        api.proposal(id, readController.signal),
        state.validationId
          ? api.validation(state.validationId, readController.signal)
          : null
      ])
      if (current !== generation || disposed) return
      if (
        proposal.id !== id ||
        proposal.changeSet.storeId !== storeId ||
        (inspection &&
          (inspection.storeId !== storeId ||
            inspection.proposal.id !== id ||
            inspection.validation.id !== state.validationId))
      ) {
        throw new Error('The proposal or validation belongs to another scope.')
      }
      const changeSet = proposal.changeSet
      if (changeSet.command === 'submit_review') {
        state.proposal = proposal
        state.preview = inspection?.preview ?? null
        state.inspection = inspection
        state.stale = true
        state.error =
          'Artifact review was removed. Create a supported lifecycle proposal.'
        return
      }
      const preview =
        inspection?.proposal.version === proposal.version
          ? inspection.preview
          : await api.preview(
              { ...changeSet, command: changeSet.command },
              readController.signal
            )
      if (current !== generation || disposed) return
      if (preview.changeDigest !== proposal.changeDigest) {
        throw new Error('The preview does not match this proposal.')
      }
      state.proposal = proposal
      state.preview = preview
      state.inspection = inspection
      state.stale = false
    } catch (error) {
      if (current === generation && !disposed) {
        state.error = errorMessage(error)
        state.stale = true
      }
    } finally {
      if (current === generation) state.loading = false
    }
  })
  function load(id: string | null, validationId: string | null) {
    ++generation
    controller?.abort()
    state.changeSetId = id
    state.validationId = validationId
    state.proposal = null
    state.preview = null
    state.inspection = null
    state.stale = true
    state.loading = false
    return refresh()
  }
  function ready() {
    const value = state.inspection
    return (
      !state.loading &&
      !state.stale &&
      Boolean(
        value?.ready &&
        value.proposal.version === state.proposal?.version &&
        value.validation.changeDigest === state.proposal.changeDigest
      )
    )
  }
  async function prepare() {
    if (state.busy || state.stale || !state.proposal) return null
    const proposal = state.proposal
    state.busy = true
    state.error = null
    try {
      const value = await api.prepare(proposal.id, proposal.version)
      if (
        value.changeSetId !== proposal.id ||
        value.version !== proposal.version
      ) {
        throw new Error('Prepared validation scope changed.')
      }
      state.validationId = value.id
      await refresh()
      return value.id
    } catch (error) {
      state.error = errorMessage(error)
      throw error
    } finally {
      state.busy = false
    }
  }
  async function control(kind: 'start' | 'cancel', presetId = '') {
    if (state.busy || !state.validationId) return
    state.busy = true
    state.error = null
    try {
      if (kind === 'start') {
        await api.start(state.validationId, presetId)
      } else {
        await api.cancel(state.validationId)
      }
      await refresh()
    } catch (error) {
      state.error = errorMessage(error)
      throw error
    } finally {
      state.busy = false
    }
  }
  async function request() {
    const value = state.inspection
    if (state.busy || !ready() || !value) {
      throw new Error('A fresh matching validation pass is required.')
    }
    state.busy = true
    state.error = null
    try {
      const pending = await api.request({
        kind: 'lifecycle',
        changeSetId: value.proposal.id,
        version: value.proposal.version,
        validationId: value.validation.id
      })
      if (
        pending.action.kind !== 'lifecycle' ||
        pending.action.changeSetId !== value.proposal.id ||
        pending.action.validationId !== value.validation.id ||
        pending.action.version !== value.proposal.version
      ) {
        throw new Error('Requested action scope changed.')
      }
      return pending.id
    } catch (error) {
      state.error = errorMessage(error)
      state.stale = true
      throw error
    } finally {
      state.busy = false
    }
  }
  function invalidate() {
    ++generation
    controller?.abort()
    state.stale = true
    return refresh()
  }
  function dispose() {
    disposed = true
    ++generation
    controller?.abort()
    state.loading = false
  }
  return {
    state,
    refresh,
    load,
    ready,
    prepare,
    control,
    request,
    invalidate,
    dispose
  }
}
