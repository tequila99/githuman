import { DEFAULT_ARTIFACT_PAGE_SIZE } from '../../shared/artifacts/constants.ts'
import { apiGet, apiPatch, apiPost } from '@/api/client'
import type {
  Artifact,
  Task,
  TaskArtifacts,
  TaskInput,
  TaskList
} from '@/api/types'

export type TaskStateFilter = 'all' | Task['state']

export interface TaskListOptions {
  cursor?: string
  search?: string
  state?: TaskStateFilter
  tags?: string[]
  tagMode?: 'all' | 'any'
}

function listQuery({
  cursor,
  search,
  state,
  tags,
  tagMode
}: TaskListOptions): string {
  const params = new URLSearchParams({
    limit: String(DEFAULT_ARTIFACT_PAGE_SIZE)
  })
  if (cursor) params.set('cursor', cursor)
  if (search) params.set('search', search)
  if (state && state !== 'all') params.set('state', state)
  for (const tag of tags ?? []) params.append('tags', tag)
  if (tags?.length && tagMode) params.set('tagMode', tagMode)
  return '?' + params.toString()
}

const taskPath = (id: string) => '/api/tasks/' + encodeURIComponent(id)

export const tasksApi = {
  list: (options: TaskListOptions, signal?: AbortSignal) =>
    apiGet<TaskList>('/api/tasks' + listQuery(options), signal),
  get: (id: string, signal?: AbortSignal) => apiGet<Task>(taskPath(id), signal),
  create: (input: TaskInput, requestId: string) =>
    apiPost<Task>('/api/tasks', { requestId, input }),
  update: (
    id: string,
    expectedVersion: number,
    input: TaskInput,
    requestId: string
  ) => apiPatch<Task>(taskPath(id), { requestId, expectedVersion, input }),
  artifacts: (id: string, signal?: AbortSignal) =>
    apiGet<TaskArtifacts>(taskPath(id) + '/artifacts', signal),
  // Bind and unbind rewrite only the task list; other metadata stays as it is.
  setArtifactTasks: (
    artifact: Artifact,
    taskIds: string[],
    requestId: string
  ) =>
    apiPatch<Artifact>(
      '/api/artifacts/' + encodeURIComponent(artifact.id) + '/metadata',
      {
        requestId,
        expectedVersion: artifact.metadataVersion,
        metadata: {
          title: artifact.title,
          tags: artifact.tags,
          ...(artifact.sourcePath ? { sourcePath: artifact.sourcePath } : {}),
          taskIds
        }
      }
    )
}
