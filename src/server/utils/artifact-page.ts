import { DEFAULT_ARTIFACT_PAGE_SIZE } from '../../shared/artifacts/constants.ts'
import { takeWithinBytes } from './take-within-bytes.ts'
import {
  ArtifactConflictError,
  ArtifactInputError
} from '../errors/artifacts.ts'

export interface ArtifactPageOptions {
  storeId: string
  epoch: number
  query: string
  limit?: number
  cursor?: string
}

/** The sort key of the last item on a page; an empty creation time is null. */
export interface PageKey {
  createdAt: string | null
  id: string
}

export interface KeyedRow<T> {
  item: T
  key: PageKey
}

function pageLimit(limit = DEFAULT_ARTIFACT_PAGE_SIZE): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ArtifactInputError('Invalid page size.')
  }
  return limit
}

// The cursor belongs to one store and one query.
function readCursor(
  cursor: string,
  storeId: string,
  query: string
): Record<string, unknown> {
  let data: Record<string, unknown> | null
  try {
    data = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw new ArtifactInputError('Invalid page cursor.')
  }
  if (!data || data.storeId !== storeId || data.query !== query) {
    throw new ArtifactInputError('Invalid page cursor.')
  }
  return data
}

function writeCursor(data: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url')
}

function isPageKey(value: unknown): value is PageKey {
  if (!value || typeof value !== 'object') return false
  const createdAt = 'createdAt' in value ? value.createdAt : undefined
  const id = 'id' in value ? value.id : undefined
  return (
    (createdAt === null || typeof createdAt === 'string') &&
    typeof id === 'string' &&
    id.length > 0
  )
}

export function artifactPage<T>(items: T[], options: ArtifactPageOptions) {
  const { storeId, epoch, query, cursor } = options
  const limit = pageLimit(options.limit)
  let offset = 0
  if (cursor) {
    const data = readCursor(cursor, storeId, query)
    if (
      typeof data.offset !== 'number' ||
      !Number.isSafeInteger(data.offset) ||
      data.offset < 0
    ) {
      throw new ArtifactInputError('Invalid page cursor.')
    }
    if (data.epoch !== epoch) {
      throw new ArtifactConflictError('Store changed. Restart pagination.')
    }
    offset = data.offset
  }
  const page = takeWithinBytes(items.slice(offset, offset + limit), limit)
  const nextCursor =
    offset + page.length < items.length
      ? writeCursor({ storeId, epoch, query, offset: offset + page.length })
      : null
  return { storeId, storeEpoch: epoch, items: page, nextCursor }
}

/**
 * A page that continues after the key of the previous page.
 * The cursor stays valid after store changes: it does not depend on positions.
 */
export function keysetPage<T>(
  read: (after: PageKey | undefined, count: number) => KeyedRow<T>[],
  options: ArtifactPageOptions
) {
  const { storeId, epoch, query, cursor } = options
  const limit = pageLimit(options.limit)
  let after: PageKey | undefined
  if (cursor) {
    const data = readCursor(cursor, storeId, query)
    if (!isPageKey(data.after)) {
      throw new ArtifactInputError('Invalid page cursor.')
    }
    after = { createdAt: data.after.createdAt, id: data.after.id }
  }
  // One extra row tells that the next page exists.
  const rows = read(after, limit + 1)
  const page = takeWithinBytes(
    rows.map(row => row.item),
    limit
  )
  const last = rows[page.length - 1]
  const nextCursor =
    page.length < rows.length && last
      ? writeCursor({ storeId, query, after: last.key })
      : null
  return { storeId, storeEpoch: epoch, items: page, nextCursor }
}
