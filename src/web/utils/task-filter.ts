import type { TaskFilter } from '@/types/tasks'

export function defaultTaskFilter(): TaskFilter {
  return { state: 'all', tags: [], tagMode: 'all' }
}

export function taskFilterActive(filter: TaskFilter): boolean {
  return filter.state !== 'all' || filter.tags.length > 0
}
