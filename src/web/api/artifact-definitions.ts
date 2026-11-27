import { DEFAULT_ARTIFACT_PAGE_SIZE } from '../../shared/artifacts/constants.ts'
import { apiGet } from '@/api/client'
import type {
  Task,
  TaskList,
  ArtifactType,
  ArtifactTypeList
} from '@/api/types'

function pageQuery(cursor?: string, search?: string, state?: Task['state']) {
  return (
    '?limit=' +
    DEFAULT_ARTIFACT_PAGE_SIZE +
    (cursor ? '&cursor=' + encodeURIComponent(cursor) : '') +
    (search ? '&search=' + encodeURIComponent(search) : '') +
    (state ? '&state=' + state : '')
  )
}

export const artifactDefinitionsApi = {
  tasks: (
    cursor?: string,
    signal?: AbortSignal,
    search?: string,
    state?: Task['state']
  ) =>
    apiGet<TaskList>('/api/tasks' + pageQuery(cursor, search, state), signal),
  types: (cursor?: string, signal?: AbortSignal, search?: string) =>
    apiGet<ArtifactTypeList>(
      '/api/artifact-types' + pageQuery(cursor, search),
      signal
    ),
  task: (id: string, signal?: AbortSignal) =>
    apiGet<Task>('/api/tasks/' + encodeURIComponent(id), signal),
  type: (id: string, signal?: AbortSignal) =>
    apiGet<ArtifactType>(
      '/api/artifact-types/' + encodeURIComponent(id),
      signal
    )
}
