import type { TaskStateFilter } from '@/api/tasks'

export interface TaskFilter {
  state: TaskStateFilter
  tags: string[]
  tagMode: 'all' | 'any'
}
