import { DEFAULT_ARTIFACT_PAGE_SIZE } from '../../shared/artifacts/constants.ts'
import { takeWithinBytes } from './take-within-bytes.ts'
import {
  ArtifactConflictError,
  ArtifactInputError
} from '../errors/artifacts.ts'

export function artifactPage<T>(
  items: T[],
  options: {
    storeId: string
    epoch: number
    query: string
    limit?: number
    cursor?: string
  }
) {
  const { storeId, epoch, query, cursor } = options
  const limit = options.limit ?? DEFAULT_ARTIFACT_PAGE_SIZE
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ArtifactInputError('Invalid page size.')
  }
  let offset = 0
  if (cursor) {
    let data: {
      storeId?: unknown
      epoch?: unknown
      query?: unknown
      offset?: unknown
    }
    try {
      data = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    } catch {
      throw new ArtifactInputError('Invalid page cursor.')
    }
    if (
      !data ||
      data.storeId !== storeId ||
      data.query !== query ||
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
      ? Buffer.from(
          JSON.stringify({
            storeId,
            epoch,
            query,
            offset: offset + page.length
          })
        ).toString('base64url')
      : null
  return { storeId, storeEpoch: epoch, items: page, nextCursor }
}
