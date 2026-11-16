import type { LocationQuery, LocationQueryRaw } from 'vue-router'
import type { JournalSearchInput } from '@/api/types'
import { isCalendarDate, localDayStartIso, localDayEndIso } from '@/utils/date'
import { isUuid } from '../../shared/utils/is-uuid.ts'

export interface JournalFilters {
  agentName: string | null
  model: string | null
  taskId: string | null
  kind: JournalSearchInput['kind'] | null
  author: JournalSearchInput['author'] | null
  createdFrom: string | null
  createdTo: string | null
}
export function defaultJournalFilters(): JournalFilters {
  return {
    agentName: null,
    model: null,
    taskId: null,
    kind: null,
    author: null,
    createdFrom: null,
    createdTo: null
  }
}
export function journalFiltersActive(filters: JournalFilters): boolean {
  return Object.values(filters).some(Boolean)
}
export function journalRouteState(query: LocationQuery) {
  const scalar = (key: string) =>
    typeof query[key] === 'string' ? query[key] : ''
  const kind = scalar('kind')
  const author = scalar('author')
  const filters: JournalFilters = {
    agentName: scalar('agentName').slice(0, 256) || null,
    model: scalar('model').slice(0, 256) || null,
    taskId: isUuid(scalar('taskId')) ? scalar('taskId') : null,
    kind:
      kind === 'done' ||
      kind === 'decision' ||
      kind === 'open' ||
      kind === 'next' ||
      kind === 'note' ||
      kind === 'system'
        ? kind
        : null,
    author:
      author === 'user' || author === 'agent' || author === 'system'
        ? author
        : null,
    createdFrom: isCalendarDate(scalar('from')) ? scalar('from') : null,
    createdTo: isCalendarDate(scalar('to')) ? scalar('to') : null
  }
  const text = scalar('q').slice(0, 256)
  const input: JournalSearchInput = {
    ...(text ? { query: text } : {}),
    ...(filters.agentName ? { agentName: filters.agentName } : {}),
    ...(filters.model ? { model: filters.model } : {}),
    ...(filters.taskId ? { taskId: filters.taskId } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.author ? { author: filters.author } : {}),
    ...(filters.createdFrom
      ? { createdFrom: localDayStartIso(filters.createdFrom) }
      : {}),
    ...(filters.createdTo
      ? { createdTo: localDayEndIso(filters.createdTo) }
      : {})
  }
  return { filters, text, input }
}
export function journalFilterQuery(
  query: LocationQuery,
  filters: JournalFilters
): LocationQueryRaw {
  const result: LocationQueryRaw = { ...query }
  for (const [key, value] of Object.entries({
    agentName: filters.agentName,
    model: filters.model,
    taskId: filters.taskId,
    kind: filters.kind,
    author: filters.author,
    from: filters.createdFrom,
    to: filters.createdTo
  })) {
    if (value) {
      result[key] = value
    } else {
      delete result[key]
    }
  }
  return result
}
