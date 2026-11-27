import type { TaskFilter } from '@/types/tasks'

// The web client starts with open tasks; the API keeps "no state" as all tasks.
export function defaultTaskFilter(): TaskFilter {
  return { state: 'open', tags: [], tagMode: 'all' }
}

export function taskFilterActive(filter: TaskFilter): boolean {
  return filter.state !== defaultTaskFilter().state || filter.tags.length > 0
}
