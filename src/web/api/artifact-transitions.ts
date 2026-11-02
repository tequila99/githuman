import { apiGet, apiPost } from '@/api/client'
import type {
  Artifact,
  ArtifactTransitionOperation,
  ArtifactTransitionOptions,
  ArtifactTransitionPreview
} from '@/api/types'

export const artifactTransitionsApi = {
  options: (artifactId: string, signal?: AbortSignal) =>
    apiGet<ArtifactTransitionOptions>(
      '/api/artifacts/' + encodeURIComponent(artifactId) + '/transitions',
      signal
    ),
  operations: (artifactId: string, signal?: AbortSignal) =>
    apiGet<{ storeId: string; items: ArtifactTransitionOperation[] }>(
      '/api/artifacts/' +
        encodeURIComponent(artifactId) +
        '/transition-operations',
      signal
    ),
  preview: (
    artifactId: string,
    targetStatus: Artifact['status'],
    signal?: AbortSignal
  ) =>
    apiPost<ArtifactTransitionPreview>(
      '/api/artifacts/' +
        encodeURIComponent(artifactId) +
        '/transition-previews',
      { targetStatus },
      signal
    ),
  start: (previewId: string, presetId: string, requestId: string) =>
    apiPost<ArtifactTransitionOperation>(
      '/api/artifact-transition-operations',
      { previewId, presetId, requestId }
    ),
  cancel: (id: string) =>
    apiPost<ArtifactTransitionOperation>(
      '/api/artifact-transition-operations/' +
        encodeURIComponent(id) +
        '/cancel'
    )
}
