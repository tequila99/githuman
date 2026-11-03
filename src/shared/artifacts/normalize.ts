import type { Artifact } from './types.ts'

// Old snapshots remain immutable; missing graph fields are supplied only when read.
export function normalizeArtifact(artifact: Artifact): Artifact {
  return {
    ...artifact,
    taskIds: artifact.taskIds ?? [],
    relations: artifact.relations ?? [],
    revisionOf: artifact.revisionOf ?? []
  }
}
