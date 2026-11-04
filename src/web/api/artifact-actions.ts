import { apiGet, apiPost, apiDelete } from '@/api/client'
import type {
  ArtifactStoredChangeSet,
  ArtifactValidationView,
  ArtifactReportChunk,
  ArtifactActionInspection,
  ArtifactActionList,
  ArtifactValidationInspection,
  ArtifactAuthorizationRequest,
  PendingArtifactAction,
  ArtifactLifecycleCommit,
  ArtifactChangeSetPreview,
  ArtifactChangeSet
} from '@/api/types'

export const artifactActionsApi = {
  list: (signal?: AbortSignal) =>
    apiGet<ArtifactActionList>('/api/artifact-actions', signal),
  inspect: (id: string, signal?: AbortSignal) =>
    apiGet<ArtifactActionInspection>(
      '/api/artifact-actions/' + encodeURIComponent(id),
      signal
    ),
  approve: (id: string, sourceUserRequestId: string) =>
    apiPost<{ authorizationId: string; expiresAt: number }>(
      '/api/artifact-actions/' + encodeURIComponent(id) + '/approve',
      { sourceUserRequestId }
    ),
  revoke: (id: string) =>
    apiDelete<{ revoked: boolean }>(
      '/api/artifact-actions/' + encodeURIComponent(id)
    ),
  commit: (id: string, input: ArtifactLifecycleCommit) =>
    apiPost<Record<string, unknown>>(
      '/api/artifact-change-sets/' + encodeURIComponent(id) + '/commit',
      input
    ),
  proposal: (id: string, signal?: AbortSignal) =>
    apiGet<ArtifactStoredChangeSet>(
      '/api/artifact-change-sets/' + encodeURIComponent(id),
      signal
    ),
  preview: (changeSet: ArtifactChangeSet, signal?: AbortSignal) =>
    apiPost<ArtifactChangeSetPreview>(
      '/api/artifacts/change-sets/preview',
      changeSet,
      signal
    ),
  validation: (id: string, signal?: AbortSignal) =>
    apiGet<ArtifactValidationInspection>(
      '/api/artifact-validations/' + encodeURIComponent(id) + '/check',
      signal
    ),
  /** Light read of one validation; `validation` below is the heavy freshness check. */
  validationView: (id: string, signal?: AbortSignal) =>
    apiGet<ArtifactValidationView>(
      '/api/artifact-validations/' + encodeURIComponent(id),
      signal
    ),
  prepare: (changeSetId: string, version: number) =>
    apiPost<ArtifactValidationView>('/api/artifact-validations', {
      changeSetId,
      version
    }),
  start: (id: string, presetId: string) =>
    apiPost<ArtifactValidationView>(
      '/api/artifact-validations/' + encodeURIComponent(id) + '/start',
      { presetId }
    ),
  cancel: (id: string) =>
    apiDelete<ArtifactValidationView>(
      '/api/artifact-validations/' + encodeURIComponent(id)
    ),
  request: (action: ArtifactAuthorizationRequest) =>
    apiPost<PendingArtifactAction>('/api/artifact-actions', action),
  report: (id: string, offset: number, signal?: AbortSignal) =>
    apiGet<ArtifactReportChunk>(
      '/api/artifact-validations/' +
        encodeURIComponent(id) +
        '/report?offset=' +
        offset,
      signal
    )
}
