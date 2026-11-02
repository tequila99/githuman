import { artifactsApi } from '@/api/artifacts'
import { createArtifactDetailPage } from '@/utils/artifact-detail-page'
import type {
  Artifact,
  ArtifactGraphPage,
  ArtifactHistory,
  ArtifactAncestry
} from '@/api/types'

type Identity = Pick<Artifact, 'storeId' | 'id'>

function assertEpoch(
  previous: { storeEpoch: number },
  next: { storeEpoch: number }
) {
  if (previous.storeEpoch !== next.storeEpoch) {
    throw new Error('The artifact graph changed. Refresh before reading more.')
  }
}

export function createArtifactRelationsPage(
  identity: Identity,
  direction: 'incoming' | 'outgoing'
) {
  return createArtifactDetailPage<ArtifactGraphPage, string>({
    storeId: identity.storeId,
    fetch: (cursor, signal) =>
      artifactsApi.relations(
        identity.id,
        direction,
        cursor ?? undefined,
        signal
      ),
    cursor: page => page.nextCursor,
    validate: page => {
      if (
        page.items.some(
          edge =>
            (direction === 'outgoing' ? edge.sourceId : edge.targetId) !==
            identity.id
        )
      ) {
        throw new Error('A relationship belongs to another artifact.')
      }
    },
    append: (previous, next) => {
      assertEpoch(previous, next)
      return { ...next, items: [...previous.items, ...next.items] }
    }
  })
}

export function createArtifactAncestryPage(identity: Identity) {
  return createArtifactDetailPage<ArtifactAncestry, string>({
    storeId: identity.storeId,
    fetch: (cursor, signal) =>
      artifactsApi.ancestry(identity.id, cursor ?? undefined, signal),
    cursor: page => page.nextCursor,
    validate: page => {
      if (
        page.artifactId !== identity.id ||
        page.ancestorIds.includes(identity.id)
      ) {
        throw new Error('The revision ancestry does not match this artifact.')
      }
    },
    append: (previous, next) => {
      assertEpoch(previous, next)
      return {
        ...next,
        ancestorIds: [...previous.ancestorIds, ...next.ancestorIds]
      }
    }
  })
}

export function createArtifactHistoryPage(identity: Identity) {
  return createArtifactDetailPage<ArtifactHistory, number>({
    storeId: identity.storeId,
    fetch: (cursor, signal) =>
      artifactsApi.history(identity.id, cursor ?? 0, signal),
    cursor: page => page.nextAfterSeq,
    validate: page => {
      let seq = 0
      for (const event of page.items) {
        if (
          event.storeId !== identity.storeId ||
          event.artifactId !== identity.id ||
          event.seq <= seq
        ) {
          throw new Error('The metadata history does not match this artifact.')
        }
        seq = event.seq
      }
      if (
        page.nextAfterSeq !== null &&
        (seq === 0 || page.nextAfterSeq !== seq)
      ) {
        throw new Error('Invalid metadata history continuation.')
      }
    },
    append: (previous, next) => {
      if (
        next.items.length &&
        next.items[0]!.seq <= (previous.items.at(-1)?.seq ?? 0)
      ) {
        throw new Error(
          'The metadata history page overlaps. Refresh the history.'
        )
      }
      return { ...next, items: [...previous.items, ...next.items] }
    }
  })
}
