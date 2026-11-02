import type { Artifact } from '@/api/types'

export interface ArtifactCatalogFilters {
  status: Artifact['status'] | null
  typeIds: string[]
  taskId: string | null
  tags: string[]
  tagMode: 'all' | 'any'
  /** Local calendar date, `YYYY-MM-DD`; null means no bound. */
  createdFrom: string | null
  createdTo: string | null
  group: 'none' | 'type' | 'task'
  mode: 'auto' | 'exact'
}
