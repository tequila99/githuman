import { DEFAULT_ARTIFACT_PAGE_SIZE } from '../../shared/artifacts/constants.ts'
import { apiGet, apiPost } from '@/api/client'
import type {
  Artifact,
  ArtifactContent,
  ArtifactHistory,
  ArtifactGraphPage,
  ArtifactAncestry,
  ArtifactSearchInput,
  ArtifactSearchResult
} from '@/api/types'

export const artifactsApi = {
  history: (id: string, afterSeq = 0, signal?: AbortSignal) =>
    apiGet<ArtifactHistory>(
      '/api/artifacts/' +
        encodeURIComponent(id) +
        '/history?limit=' +
        DEFAULT_ARTIFACT_PAGE_SIZE +
        '&afterSeq=' +
        afterSeq,
      signal
    ),
  relations: (
    id: string,
    direction: 'outgoing' | 'incoming',
    cursor?: string,
    signal?: AbortSignal
  ) =>
    apiGet<ArtifactGraphPage>(
      '/api/artifacts/' +
        encodeURIComponent(id) +
        '/relations?limit=' +
        DEFAULT_ARTIFACT_PAGE_SIZE +
        '&direction=' +
        direction +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
      signal
    ),
  ancestry: (id: string, cursor?: string, signal?: AbortSignal) =>
    apiGet<ArtifactAncestry>(
      '/api/artifacts/' +
        encodeURIComponent(id) +
        '/ancestry?limit=' +
        DEFAULT_ARTIFACT_PAGE_SIZE +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
      signal
    ),

  search: (input: ArtifactSearchInput, signal?: AbortSignal) =>
    apiPost<ArtifactSearchResult>('/api/artifacts/search', input, signal),
  get: (id: string, signal?: AbortSignal) =>
    apiGet<Artifact>('/api/artifacts/' + encodeURIComponent(id), signal),
  content: (id: string, offset: number, signal?: AbortSignal) =>
    apiGet<ArtifactContent>(
      '/api/artifacts/' + encodeURIComponent(id) + '/content?offset=' + offset,
      signal
    )
}
