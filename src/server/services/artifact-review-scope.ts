import type { ArtifactStorageService } from './artifact-storage.service.ts'
import type { ArtifactThreadCurrent } from '../../shared/artifacts/types.ts'

interface ReviewNode {
  lineage: Set<string>
  targets: Set<string>
}

export interface ReviewSources {
  rootId: string
  origins: Set<string>
  nodes: Map<string, ReviewNode>
  parents: Map<string, Set<string>>
}

export function reviewSources(
  rootId: string,
  storage: Pick<ArtifactStorageService, 'get' | 'graphRepository'>
): ReviewSources {
  const nodes = new Map<string, ReviewNode>(),
    origins = new Set<string>()
  const parents = new Map<string, Set<string>>(),
    queue = [rootId]
  const scheduled = new Set(queue)
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]
    const lineage = new Set([id, ...storage.graphRepository.ancestors(id)])
    const targets = new Set<string>()
    for (const ancestor of lineage) {
      origins.add(ancestor)
      for (const relation of storage.get(ancestor).relations) {
        if (relation.kind === 'replaces' || relation.kind === 'supplements') {
          targets.add(relation.targetId)
        }
      }
    }
    nodes.set(id, { lineage, targets })
    for (const target of targets) {
      const dependants = parents.get(target) ?? new Set<string>()
      dependants.add(id)
      parents.set(target, dependants)
      if (scheduled.has(target)) continue
      scheduled.add(target)
      queue.push(target)
    }
  }
  return { rootId, nodes, origins, parents }
}

export function isReviewThreadOpen(
  thread: ArtifactThreadCurrent,
  sources: ReviewSources
): boolean {
  const relevant = new Set<string>(),
    queue: string[] = []
  for (const [id, node] of sources.nodes) {
    if (node.lineage.has(thread.originArtifactId)) {
      relevant.add(id)
      queue.push(id)
    }
  }
  for (let index = 0; index < queue.length; index++) {
    for (const parent of sources.parents.get(queue[index]) ?? []) {
      if (relevant.has(parent)) continue
      relevant.add(parent)
      queue.push(parent)
    }
  }
  const resolutions = new Map(
    thread.resolutions.map(item => [item.scope.appliesToArtifactId, item])
  )
  const open = new Set<string>(),
    fixed = new Set<string>(),
    pending: string[] = []
  for (const id of relevant) {
    const node = sources.nodes.get(id)!
    let decision: ArtifactThreadCurrent['resolutions'][number] | undefined
    for (const ancestor of node.lineage) {
      const candidate = resolutions.get(ancestor)
      if (candidate && (!decision || candidate.seq > decision.seq)) {
        decision = candidate
      }
    }
    if (decision) fixed.add(id)
    if (
      decision ? !decision.resolved : node.lineage.has(thread.originArtifactId)
    ) {
      open.add(id)
      pending.push(id)
    }
  }
  // Propagate to a fixed point; caching a recursive cycle as closed loses open paths.
  for (let index = 0; index < pending.length; index++) {
    for (const parent of sources.parents.get(pending[index]) ?? []) {
      if (!relevant.has(parent) || fixed.has(parent) || open.has(parent)) {
        continue
      }
      open.add(parent)
      pending.push(parent)
    }
  }
  return open.has(sources.rootId)
}
