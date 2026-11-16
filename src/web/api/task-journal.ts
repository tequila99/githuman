import { apiGet, apiPost } from './client'
import type {
  JournalAppend,
  JournalEntry,
  JournalPage,
  JournalSearchInput,
  JournalSearchPage,
  Handoff,
  HandoffPreview,
  SessionHandoffPreview
} from './types'

export const taskJournalApi = {
  search(input: JournalSearchInput, signal?: AbortSignal) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) query.set(key, String(value))
    }
    return apiGet<JournalSearchPage>(`/api/task-journal?${query}`, signal)
  },
  list(
    taskId: string,
    storeId: string,
    beforeSeq?: number,
    throughSeq?: number
  ) {
    const query = new URLSearchParams({ storeId })
    if (beforeSeq !== undefined) query.set('beforeSeq', String(beforeSeq))
    if (throughSeq !== undefined) query.set('throughSeq', String(throughSeq))
    return apiGet<JournalPage>(
      `/api/tasks/${encodeURIComponent(taskId)}/journal?${query}`
    )
  },
  append(taskId: string, storeId: string, input: JournalAppend) {
    return apiPost<JournalEntry>(
      `/api/tasks/${encodeURIComponent(taskId)}/journal`,
      { ...input, storeId }
    )
  },
  preview(taskId: string, input: HandoffPreview) {
    return apiPost<Handoff>(
      `/api/tasks/${encodeURIComponent(taskId)}/handoffs/preview`,
      input
    )
  },
  previewSession(input: SessionHandoffPreview) {
    return apiPost<Handoff>('/api/session-handoffs/preview', input)
  },
  confirm(id: string, digest: string) {
    return apiPost<Handoff>(
      `/api/task-handoffs/${encodeURIComponent(id)}/confirm`,
      { digest }
    )
  },
  handoff(id: string) {
    return apiGet<Handoff>(`/api/task-handoffs/${encodeURIComponent(id)}`)
  }
}
