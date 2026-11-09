import type {
  LocationQuery,
  LocationQueryRaw,
  RouteLocationRaw
} from 'vue-router'
import {
  ARTIFACT_STATUSES,
  INACTIVE_ARTIFACT_STATUSES
} from '../../shared/artifacts/constants.ts'
import { isCalendarDate, localDayStartIso, localDayEndIso } from '@/utils/date'
import { isUuid } from '../../shared/utils/is-uuid.ts'
import type { ArtifactSearchInput } from '@/api/types'
import type { ArtifactCatalogFilters } from '@/types/artifacts'

function scalar(query: LocationQuery, key: string): string {
  const value = query[key]
  return typeof value === 'string' ? value : ''
}

function list(query: LocationQuery, key: string): string[] {
  const value = query[key]
  const items = Array.isArray(value) ? value : [value]
  return [
    ...new Set(
      items.filter(
        (item): item is string => typeof item === 'string' && Boolean(item)
      )
    )
  ]
}

export function defaultArtifactFilters(): ArtifactCatalogFilters {
  return {
    status: null,
    typeIds: [],
    taskId: null,
    tags: [],
    tagMode: 'all',
    createdFrom: null,
    createdTo: null,
    group: 'none',
    mode: 'auto'
  }
}

export function artifactFiltersActive(
  filters: ArtifactCatalogFilters
): boolean {
  return (
    filters.status !== null ||
    filters.typeIds.length > 0 ||
    filters.taskId !== null ||
    filters.tags.length > 0 ||
    filters.createdFrom !== null ||
    filters.createdTo !== null ||
    filters.group !== 'none' ||
    filters.mode !== 'auto'
  )
}

export function artifactFilterQuery(
  query: LocationQuery,
  filters: ArtifactCatalogFilters
): LocationQueryRaw {
  const result: LocationQueryRaw = { ...query }
  const values: Record<string, string | string[] | null> = {
    status: filters.status ?? 'all',
    typeId: filters.typeIds,
    taskId: filters.taskId,
    tag: filters.tags,
    tagMode:
      filters.tags.length > 1 && filters.tagMode === 'any' ? 'any' : null,
    from: filters.createdFrom,
    to: filters.createdTo,
    group: filters.group === 'none' ? null : filters.group,
    mode: filters.mode === 'auto' ? null : filters.mode
  }
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value) ? value.length : value) {
      result[key] = value
    } else {
      delete result[key]
    }
  }
  return result
}

export function artifactRouteState(query: LocationQuery) {
  const status =
    scalar(query, 'status') === 'all'
      ? null
      : (ARTIFACT_STATUSES.find(value => value === scalar(query, 'status')) ??
        'active')
  const group = scalar(query, 'group')
  const storeId = scalar(query, 'storeId')
  const selectedId = scalar(query, 'selectedId')
  const taskId = scalar(query, 'taskId')
  const filters: ArtifactCatalogFilters = {
    status,
    typeIds: list(query, 'typeId'),
    taskId: isUuid(taskId) ? taskId : null,
    tags: list(query, 'tag'),
    tagMode: scalar(query, 'tagMode') === 'any' ? 'any' : 'all',
    createdFrom: isCalendarDate(scalar(query, 'from'))
      ? scalar(query, 'from')
      : null,
    createdTo: isCalendarDate(scalar(query, 'to')) ? scalar(query, 'to') : null,
    group: group === 'type' || group === 'task' ? group : 'none',
    mode: scalar(query, 'mode') === 'exact' ? 'exact' : 'auto'
  }
  const input: ArtifactSearchInput = {
    query: scalar(query, 'q'),
    mode: filters.mode,
    // Newest documents stay on top, with or without a text query.
    sort: 'createdAt',
    limit: 50,
    filters: {
      // The API defaults to accepted when statuses are omitted.
      statuses:
        status === null
          ? [...ARTIFACT_STATUSES]
          : status === 'active'
            ? ARTIFACT_STATUSES.filter(
                value => !INACTIVE_ARTIFACT_STATUSES.includes(value)
              )
            : [status],
      ...(filters.typeIds.length ? { typeIds: filters.typeIds } : {}),
      ...(filters.taskId ? { taskIds: [filters.taskId] } : {}),
      ...(filters.tags.length
        ? { tags: filters.tags, tagMode: filters.tagMode }
        : {}),
      ...(filters.createdFrom
        ? { createdFrom: localDayStartIso(filters.createdFrom) }
        : {}),
      ...(filters.createdTo
        ? { createdTo: localDayEndIso(filters.createdTo) }
        : {})
    }
  }
  return {
    input,
    filters,
    group: filters.group,
    selection:
      isUuid(storeId) && isUuid(selectedId) ? { storeId, id: selectedId } : null
  }
}

export function artifactDocumentRoute(
  storeId: string,
  id: string,
  query: LocationQuery = {}
): RouteLocationRaw {
  return {
    path: '/artifacts',
    query: {
      ...query,
      storeId,
      selectedId: id,
      uiPane: 'content',
      uiWindow: undefined
    }
  }
}
