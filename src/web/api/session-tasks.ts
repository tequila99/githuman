import { apiGet, apiPatch } from '@/api/client'
import type { SessionTaskAssignment, SessionTaskRequest } from '@/api/types'

export const sessionTasksApi = {
  get: (id: string, signal?: AbortSignal) =>
    apiGet<SessionTaskAssignment>(
      '/api/tasks/sessions/' + encodeURIComponent(id),
      signal
    ),
  assign: (id: string, input: SessionTaskRequest) =>
    apiPatch<SessionTaskAssignment>(
      '/api/tasks/sessions/' + encodeURIComponent(id),
      input
    )
}
