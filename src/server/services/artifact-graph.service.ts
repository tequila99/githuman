import { Value } from '@sinclair/typebox/value'
import {
  ArtifactChangeSetSchema,
  GraphPageQuery
} from '../../shared/artifacts/schemas.ts'
import type {
  ArtifactChangeSet,
  ArtifactRelation
} from '../../shared/artifacts/types.ts'
import { ArtifactInputError } from '../errors/artifacts.ts'
import { artifactPage } from '../utils/artifact-page.ts'
import { previewArtifactChangeSet } from './artifact-graph-validation.ts'
import type { ArtifactStorageService } from './artifact-storage.service.ts'

export class ArtifactGraphService {
  private readonly storage: ArtifactStorageService
  constructor(storage: ArtifactStorageService) {
    this.storage = storage
  }
  relations(
    id: string,
    options: {
      limit?: number
      cursor?: string
      direction?: 'incoming' | 'outgoing'
      kind?: ArtifactRelation['kind']
    } = {}
  ) {
    if (!Value.Check(GraphPageQuery, options)) {
      throw new ArtifactInputError('Invalid graph page options.')
    }
    return this.storage.catalog.readSnapshot(() => {
      this.storage.get(id)
      const direction = options.direction ?? 'outgoing'
      return artifactPage(
        this.storage.graphRepository.edges(id, direction, options.kind),
        {
          storeId: this.storage.storeId,
          epoch: this.storage.catalog.epoch(),
          query: `graph:${id}:${direction}:${options.kind ?? ''}`,
          limit: options.limit,
          cursor: options.cursor
        }
      )
    })
  }
  ancestry(id: string, limit = 50, cursor?: string) {
    return this.storage.catalog.readSnapshot(() => {
      this.storage.get(id)
      const page = artifactPage(this.storage.graphRepository.ancestors(id), {
        storeId: this.storage.storeId,
        epoch: this.storage.catalog.epoch(),
        query: `ancestry:${id}`,
        limit,
        cursor
      })
      return {
        storeId: page.storeId,
        storeEpoch: page.storeEpoch,
        artifactId: id,
        ancestorIds: page.items,
        nextCursor: page.nextCursor
      }
    })
  }
  previewChangeSet(input: ArtifactChangeSet) {
    if (!Value.Check(ArtifactChangeSetSchema, input) || !input.reason.trim()) {
      throw new ArtifactInputError('Invalid change set.')
    }
    if (input.storeId !== this.storage.storeId) {
      throw new ArtifactInputError('Change set belongs to another store.')
    }
    return this.storage.catalog.readSnapshot(() => {
      const result = previewArtifactChangeSet(
        this.storage.catalog.all(),
        input,
        this.storage.catalog.supersededArtifactIds()
      )
      for (const id of result.affectedIds) {
        const artifact = this.storage.catalog.get(id)
        if (artifact) {
          this.storage.files.verify(
            `${this.storage.files.prefix}${id}.md`,
            artifact.sha256,
            artifact.bytes
          )
        }
      }
      return result
    })
  }
}
