import type { DatabaseSync } from 'node:sqlite'
import type {
  Artifact,
  ArtifactRelation
} from '../../shared/artifacts/types.ts'
import type { ArtifactCatalogRepository } from './artifact-catalog.repo.ts'
import { ArtifactIntegrityError } from '../errors/artifacts.ts'

export class ArtifactGraphRepository {
  private readonly db: DatabaseSync
  private readonly catalog: ArtifactCatalogRepository
  constructor(db: DatabaseSync, catalog: ArtifactCatalogRepository) {
    this.db = db
    this.catalog = catalog
  }
  appendLineage(artifact: Artifact): void {
    const parent = artifact.revisionOf?.[0]
    if (parent) {
      this.db
        .prepare('INSERT INTO artifact_revision_parents VALUES(?,?,?)')
        .run(this.catalog.storeId, artifact.id, parent)
    }
  }
  ancestors(id: string): string[] {
    const result: string[] = []
    const visited = new Set([id])
    let child = id
    for (;;) {
      const row = this.db
        .prepare(
          'SELECT parent_id FROM artifact_revision_parents WHERE store_id=? AND child_id=?'
        )
        .get(this.catalog.storeId, child) as { parent_id: string } | undefined
      if (!row) return result
      if (visited.has(row.parent_id)) {
        throw new ArtifactIntegrityError('Artifact lineage contains a cycle.')
      }
      visited.add(row.parent_id)
      result.push(row.parent_id)
      child = row.parent_id
    }
  }
  edges(
    id: string,
    direction: 'incoming' | 'outgoing',
    kind?: ArtifactRelation['kind']
  ) {
    return this.catalog
      .all()
      .flatMap(artifact =>
        artifact.relations
          .filter(
            relation =>
              (direction === 'incoming'
                ? relation.targetId === id
                : artifact.id === id) &&
              (!kind || relation.kind === kind)
          )
          .map(relation => ({
            sourceId: artifact.id,
            targetId: relation.targetId,
            kind: relation.kind
          }))
      )
      .sort((a, b) =>
        `${a.sourceId}:${a.kind}:${a.targetId}`.localeCompare(
          `${b.sourceId}:${b.kind}:${b.targetId}`
        )
      )
  }
}
