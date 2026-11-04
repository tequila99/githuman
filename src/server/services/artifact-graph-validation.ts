import type {
  Artifact,
  ArtifactHistoricalChangeSet,
  ArtifactRelation,
  GraphIssue
} from '../../shared/artifacts/types.ts'
import { canonicalJson } from '../../shared/utils/canonical-json.ts'
import { sha256Hex } from '../utils/hash.ts'
import { allowedTransition } from '../../shared/artifact-transitions/transitions.ts'

// A large store can give hundreds of issues. The full list is in the change set preview.
const MAX_REPORTED_GRAPH_ISSUES = 20
// Limit for artifact IDs in one issue line; the rest show as a count.
const MAX_REPORTED_ISSUE_ARTIFACTS = 20

// Status that a lifecycle command gives to each of its subjects.
const COMMAND_STATUS: Partial<
  Record<ArtifactHistoricalChangeSet['command'], Artifact['status']>
> = {
  return_to_draft: 'draft',
  reject: 'rejected',
  accept: 'accepted',
  archive: 'archived',
  delete: 'deleted',
  restore: 'draft'
}

type EdgeKind = 'hierarchy' | 'priority' | 'lineage'

/**
 * Builds one error text that names the artifacts of each issue.
 * Without the IDs and current versions, a caller cannot correct the change set.
 * Issues with the same code and text merge into one line.
 */
export function graphIssuesMessage(
  issues: readonly GraphIssue[],
  versions: readonly { id: string; version: number }[] = []
): string {
  const current = new Map(versions.map(item => [item.id, item.version]))
  const groups = new Map<string, { issue: GraphIssue; ids: Set<string> }>()
  for (const issue of issues) {
    const key = `${issue.code}\0${issue.message}`
    const group = groups.get(key) ?? { issue, ids: new Set<string>() }
    for (const id of issue.artifactIds) group.ids.add(id)
    groups.set(key, group)
  }
  const lines = [...groups.values()].map(({ issue, ids }) => {
    const all = [...ids].map(id =>
      current.has(id) ? `${id}@v${current.get(id)}` : id
    )
    const shown = all.slice(0, MAX_REPORTED_ISSUE_ARTIFACTS)
    if (all.length > shown.length) {
      shown.push(`+${all.length - shown.length} more`)
    }
    return shown.length
      ? `${issue.code} [${shown.join(', ')}]: ${issue.message}`
      : `${issue.code}: ${issue.message}`
  })
  const shown = lines.slice(0, MAX_REPORTED_GRAPH_ISSUES)
  if (lines.length > shown.length) {
    shown.push(
      `${lines.length - shown.length} more issues. Preview the change set for the full list.`
    )
  }
  return shown.join(' ')
}

// Each kind is a separate graph that must stay acyclic.
function edgeTargets(kind: EdgeKind, artifact: Artifact): string[] {
  if (kind === 'lineage') return artifact.revisionOf
  return artifact.relations
    .filter(relation =>
      kind === 'hierarchy'
        ? relation.kind === 'parent'
        : relation.kind === 'replaces' || relation.kind === 'supplements'
    )
    .map(relation => relation.targetId)
}

// Check one written artifact against a valid store. Every new cycle contains the
// artifact, because only its own edges are new, so a walk from it finds them all.
export function artifactIssues(
  artifact: Artifact,
  lookup: (id: string) => Artifact | undefined,
  storeId: string
): GraphIssue[] {
  const errors: GraphIssue[] = []
  const issue = (code: string, artifactIds: string[], message: string) =>
    errors.push({ code, artifactIds, message })
  const find = (id: string) => (id === artifact.id ? artifact : lookup(id))
  if (artifact.storeId !== storeId) {
    issue(
      'foreign_store',
      [artifact.id],
      'Artifacts must belong to the same store.'
    )
  }
  const keys = new Set<string>()
  for (const relation of artifact.relations) {
    if (relation.targetId === artifact.id) {
      issue('self_link', [artifact.id], 'An artifact cannot link to itself.')
    }
    if (!find(relation.targetId)) {
      issue(
        'missing_target',
        [artifact.id, relation.targetId],
        'Relationship target is absent from this store.'
      )
    }
    const key = `${relation.kind}:${relation.targetId}`
    if (keys.has(key)) {
      issue(
        'duplicate_relation',
        [artifact.id, relation.targetId],
        'Duplicate relationship.'
      )
    }
    keys.add(key)
  }
  if (artifact.revisionOf.length > 1) {
    issue(
      'invalid_lineage',
      [artifact.id],
      'A revision has at most one predecessor.'
    )
  }
  for (const parent of artifact.revisionOf) {
    if (parent === artifact.id || !find(parent)) {
      issue(
        'invalid_lineage',
        [artifact.id, parent],
        'Lineage predecessor must exist in the same store.'
      )
    }
    if (
      find(parent)?.status === 'accepted' &&
      !artifact.relations.some(
        r =>
          r.targetId === parent &&
          (r.kind === 'replaces' || r.kind === 'supplements')
      )
    ) {
      issue(
        'missing_revision_priority',
        [artifact.id, parent],
        'A revision of an accepted artifact must replace or supplement it.'
      )
    }
  }
  for (const kind of ['hierarchy', 'priority', 'lineage'] as const) {
    const visited = new Set<string>()
    const stack = [...edgeTargets(kind, artifact)]
    while (stack.length) {
      const id = stack.pop()!
      if (id === artifact.id) {
        issue(`${kind}_cycle`, [artifact.id], `${kind} graph contains a cycle.`)
        break
      }
      if (visited.has(id)) continue
      visited.add(id)
      const node = find(id)
      if (node) stack.push(...edgeTargets(kind, node))
    }
  }
  return errors
}

export function graphIssues(
  artifacts: readonly Artifact[],
  storeId: string
): GraphIssue[] {
  const nodes = new Map(artifacts.map(artifact => [artifact.id, artifact]))
  const errors: GraphIssue[] = []
  const issue = (code: string, artifactIds: string[], message: string) =>
    errors.push({ code, artifactIds, message })
  for (const artifact of artifacts) {
    if (artifact.storeId !== storeId) {
      issue(
        'foreign_store',
        [artifact.id],
        'Artifacts must belong to the same store.'
      )
    }
    const keys = new Set<string>()
    for (const relation of artifact.relations) {
      if (relation.targetId === artifact.id) {
        issue('self_link', [artifact.id], 'An artifact cannot link to itself.')
      }
      if (!nodes.has(relation.targetId)) {
        issue(
          'missing_target',
          [artifact.id, relation.targetId],
          'Relationship target is absent from this store.'
        )
      }
      const key = `${relation.kind}:${relation.targetId}`
      if (keys.has(key)) {
        issue(
          'duplicate_relation',
          [artifact.id, relation.targetId],
          'Duplicate relationship.'
        )
      }
      keys.add(key)
    }
    if (artifact.revisionOf.length > 1) {
      issue(
        'invalid_lineage',
        [artifact.id],
        'A revision has at most one predecessor.'
      )
    }
    for (const parent of artifact.revisionOf) {
      if (parent === artifact.id || !nodes.has(parent)) {
        issue(
          'invalid_lineage',
          [artifact.id, parent],
          'Lineage predecessor must exist in the same store.'
        )
      }
      if (
        nodes.get(parent)?.status === 'accepted' &&
        !artifact.relations.some(
          r =>
            r.targetId === parent &&
            (r.kind === 'replaces' || r.kind === 'supplements')
        )
      ) {
        issue(
          'missing_revision_priority',
          [artifact.id, parent],
          'A revision of an accepted artifact must replace or supplement it.'
        )
      }
    }
  }
  for (const kind of ['hierarchy', 'priority', 'lineage'] as const) {
    const color = new Map<string, number>()
    const next = (artifact: Artifact) => edgeTargets(kind, artifact)
    // Iterative DFS avoids exhausting the call stack on long revision chains.
    for (const node of artifacts) {
      if (color.has(node.id)) continue
      const stack = [{ id: node.id, exit: false }]
      while (stack.length) {
        const frame = stack.pop()!
        if (frame.exit) {
          color.set(frame.id, 2)
          continue
        }
        if (color.get(frame.id) === 2) continue
        if (color.get(frame.id) === 1) {
          issue(`${kind}_cycle`, [frame.id], `${kind} graph contains a cycle.`)
          continue
        }
        color.set(frame.id, 1)
        stack.push({ id: frame.id, exit: true })
        for (const target of next(nodes.get(frame.id)!)) {
          if (!nodes.has(target)) continue
          if (color.get(target) === 1) {
            issue(
              `${kind}_cycle`,
              [frame.id, target],
              `${kind} graph contains a cycle.`
            )
          } else if (!color.has(target)) {
            stack.push({ id: target, exit: false })
          }
        }
      }
    }
  }
  return errors
}

function relations(items: ArtifactRelation[]) {
  return [...items]
    .map(relation => ({ kind: relation.kind, targetId: relation.targetId }))
    .sort((a, b) =>
      `${a.kind}:${a.targetId}`.localeCompare(`${b.kind}:${b.targetId}`)
    )
}

export function canonicalChangeSet(
  input: ArtifactHistoricalChangeSet
): ArtifactHistoricalChangeSet {
  return {
    ...input,
    subjectIds: [...input.subjectIds].sort(),
    expectedVersions: [...input.expectedVersions].sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    relationChanges: input.relationChanges
      .map(change => ({ ...change, relations: relations(change.relations) }))
      .sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
    targetStatuses: [...input.targetStatuses].sort((a, b) =>
      a.artifactId.localeCompare(b.artifactId)
    ),
    supplementDispositions: [...input.supplementDispositions].sort((a, b) =>
      a.artifactId.localeCompare(b.artifactId)
    )
  }
}

export function previewArtifactChangeSet(
  current: readonly Artifact[],
  input: ArtifactHistoricalChangeSet,
  previouslySuperseded: ReadonlySet<string> = new Set()
) {
  const canonical = canonicalChangeSet(input)
  const nodes = new Map(current.map(artifact => [artifact.id, artifact]))
  const post = new Map(
    current.map(artifact => [artifact.id, structuredClone(artifact)])
  )
  const errors: GraphIssue[] = []
  const error = (code: string, artifactIds: string[], message: string) =>
    errors.push({ code, artifactIds, message })
  if (canonical.command === 'submit_review') {
    error(
      'unsupported_command',
      canonical.subjectIds,
      'Artifact review was removed. Create a supported lifecycle proposal.'
    )
  }
  const affected = new Set(canonical.subjectIds)
  const retired = new Set<string>()
  for (const collection of [
    canonical.expectedVersions.map(v => v.id),
    canonical.relationChanges.map(v => v.artifactId),
    canonical.targetStatuses.map(v => v.artifactId),
    canonical.supplementDispositions.map(v => v.artifactId)
  ]) {
    if (new Set(collection).size !== collection.length) {
      error(
        'duplicate_change',
        collection,
        'A change set contains duplicate entries.'
      )
    }
  }
  for (const id of canonical.subjectIds) {
    if (!nodes.has(id)) {
      error(
        'missing_subject',
        [id],
        'Change set subject is absent from this store.'
      )
    }
  }
  for (const change of canonical.relationChanges) {
    const node = post.get(change.artifactId)
    if (!node) {
      error(
        'missing_target',
        [change.artifactId],
        'Changed artifact is absent from this store.'
      )
      continue
    }
    const before = nodes.get(change.artifactId)
    if (before?.status === 'accepted') {
      // Only the acceptance of a new document may replace an active one.
      const had = new Set(
        before.relations
          .filter(edge => edge.kind === 'replaces')
          .map(edge => edge.targetId)
      )
      if (
        change.relations.some(
          edge => edge.kind === 'replaces' && !had.has(edge.targetId)
        )
      ) {
        error(
          'replaces_on_active_artifact',
          [change.artifactId],
          'An accepted artifact cannot gain a replaces link.'
        )
      }
    }
    node.relations = structuredClone(change.relations)
    affected.add(node.id)
  }
  if (
    canonical.command === 'update_relations' &&
    !canonical.relationChanges.length
  ) {
    error(
      'empty_change_set',
      canonical.subjectIds,
      'An update_relations change set needs relation changes.'
    )
  }
  const dispositionIds = new Set(
    canonical.supplementDispositions.map(item => item.artifactId)
  )
  for (const change of canonical.targetStatuses) {
    const subject = canonical.subjectIds.includes(change.artifactId)
    const allowed = subject
      ? change.status === COMMAND_STATUS[canonical.command]
      : canonical.command === 'accept' && change.status === 'superseded'
    if (!allowed) {
      error(
        'status_not_allowed_for_command',
        [change.artifactId],
        `Command ${canonical.command} cannot set status ${change.status}.`
      )
    }
    if (dispositionIds.has(change.artifactId)) {
      error(
        'status_duplicates_disposition',
        [change.artifactId],
        'A supplement status comes from its disposition only.'
      )
    }
  }
  for (const change of canonical.targetStatuses) {
    const node = post.get(change.artifactId)
    if (!node) {
      error(
        'missing_target',
        [change.artifactId],
        'Changed artifact is absent from this store.'
      )
      continue
    }
    if (
      !allowedTransition(node.status, change.status) &&
      !(canonical.command === 'accept' && change.status === 'superseded')
    ) {
      error(
        'invalid_transition',
        [node.id],
        `Transition ${node.status} to ${change.status} is not allowed.`
      )
    }
    if (
      canonical.subjectIds.includes(node.id) &&
      ((canonical.command === 'restore' &&
        !['archived', 'deleted'].includes(node.status)) ||
        (canonical.command === 'return_to_draft' &&
          !['in_review', 'rejected'].includes(node.status)))
    ) {
      error(
        'invalid_transition',
        [node.id],
        'The command does not apply to the current status.'
      )
    }
    node.status = change.status
    affected.add(node.id)
  }
  for (const id of canonical.subjectIds) {
    const node = post.get(id)
    if (!node) continue
    const expectedStatus = COMMAND_STATUS[canonical.command]
    if (expectedStatus && node.status !== expectedStatus) {
      error(
        'missing_subject_status',
        [id],
        'The command must include the subject target status.'
      )
    }
  }
  // Replacements and lineage retire predecessors only in the proposed poststate.
  for (const node of post.values()) {
    if (
      node.status !== 'accepted' ||
      nodes.get(node.id)?.status === 'accepted'
    ) {
      continue
    }
    for (const relation of node.relations.filter(
      edge => edge.kind === 'replaces'
    )) {
      const target = post.get(relation.targetId)
      if (target) {
        if (
          nodes.get(target.id)?.status !== 'accepted' &&
          (!['draft', 'in_review'].includes(nodes.get(target.id)!.status) ||
            !isAncestor(target.id, node, nodes))
        ) {
          error(
            'invalid_replacement',
            [node.id, target.id],
            'Replacement target is not active or in review.'
          )
        }
        target.status = 'superseded'
        retired.add(target.id)
        affected.add(target.id)
      }
    }
    let parent = node.revisionOf[0]
    const visited = new Set<string>()
    while (parent && !visited.has(parent)) {
      visited.add(parent)
      const ancestor = post.get(parent)
      if (!ancestor) break
      if (
        nodes.get(parent)?.status === 'draft' ||
        nodes.get(parent)?.status === 'in_review'
      ) {
        ancestor.status = 'superseded'
        retired.add(parent)
        affected.add(parent)
      }
      parent = ancestor.revisionOf[0]
    }
  }
  const required = new Set<string>()
  // A replacement of a base also affects supplements of its supplements.
  const inactive = new Set(
    [...post.values()]
      .filter(
        node =>
          nodes.get(node.id)?.status === 'accepted' &&
          node.status !== 'accepted'
      )
      .map(node => node.id)
  )
  let changed = true
  while (changed) {
    changed = false
    for (const node of current) {
      if (
        node.status === 'accepted' &&
        !required.has(node.id) &&
        node.relations.some(
          r => r.kind === 'supplements' && inactive.has(r.targetId)
        )
      ) {
        required.add(node.id)
        inactive.add(node.id)
        affected.add(node.id)
        changed = true
      }
    }
  }
  const includedIn: { artifactId: string; targetId: string }[] = []
  for (const id of required) {
    const disposition = canonical.supplementDispositions.find(
      item => item.artifactId === id
    )
    if (!disposition) {
      error(
        'missing_supplement_disposition',
        [id],
        'Every active supplement needs an explicit disposition.'
      )
      continue
    }
    const node = post.get(id)!
    if (disposition.disposition === 'carry_forward') {
      const base = disposition.newBaseId
        ? post.get(disposition.newBaseId)
        : undefined
      if (
        !base ||
        base.id === id ||
        base.status !== 'accepted' ||
        disposition.targetStatus
      ) {
        error(
          'invalid_disposition',
          [id],
          'Carry-forward requires a new accepted base.'
        )
      } else {
        node.status = 'accepted'
        node.relations = node.relations.filter(
          relation =>
            relation.kind !== 'supplements' || !inactive.has(relation.targetId)
        )
        if (
          !node.relations.some(
            relation =>
              relation.kind === 'supplements' && relation.targetId === base.id
          )
        ) {
          node.relations.push({ kind: 'supplements', targetId: base.id })
        }
        affected.add(base.id)
      }
    } else if (disposition.disposition === 'obsolete') {
      if (!disposition.targetStatus || disposition.newBaseId) {
        error(
          'invalid_disposition',
          [id],
          'Obsolete requires archived or deleted as target status.'
        )
      } else {
        node.status = disposition.targetStatus
      }
    } else {
      if (
        disposition.newBaseId ||
        disposition.targetStatus ||
        canonical.command !== 'accept'
      ) {
        error(
          'invalid_disposition',
          [id],
          'Incorporated is allowed only as part of acceptance.'
        )
      }
      node.status = 'archived'
      for (const targetId of canonical.subjectIds) {
        includedIn.push({ artifactId: id, targetId })
      }
    }
  }
  for (const target of canonical.targetStatuses) {
    if (target.status === 'superseded' && !retired.has(target.artifactId)) {
      error(
        'invalid_supersession',
        [target.artifactId],
        'Supersession must result from an accepted replacement or lineage.'
      )
    }
    if (post.get(target.artifactId)?.status !== target.status) {
      error(
        'conflicting_target_status',
        [target.artifactId],
        'Explicit and derived target statuses disagree.'
      )
    }
  }
  for (const disposition of canonical.supplementDispositions) {
    if (!required.has(disposition.artifactId)) {
      error(
        'unexpected_disposition',
        [disposition.artifactId],
        'The supplement is not affected by this change set.'
      )
    }
  }
  for (const node of post.values()) {
    if (node.status === 'accepted') {
      for (const relation of node.relations) {
        if (
          relation.kind === 'replaces' &&
          !['superseded', 'archived', 'deleted'].includes(
            post.get(relation.targetId)?.status ?? ''
          )
        ) {
          error(
            'active_replacement_target',
            [node.id, relation.targetId],
            'An accepted replacement requires an inactive predecessor.'
          )
        }
        if (
          relation.kind === 'supplements' &&
          post.get(relation.targetId)?.status !== 'accepted'
        ) {
          error(
            'inactive_supplement_base',
            [node.id, relation.targetId],
            'An active supplement needs an accepted base.'
          )
        }
      }
    }
  }
  const replacements = new Map<string, string>()
  for (const node of post.values()) {
    if (node.status !== 'accepted') continue
    for (const relation of node.relations) {
      if (relation.kind !== 'replaces') continue
      const previous = replacements.get(relation.targetId)
      if (previous && previous !== node.id) {
        error(
          'competing_replacements',
          [previous, node.id, relation.targetId],
          'An artifact cannot have two active replacements.'
        )
      }
      replacements.set(relation.targetId, node.id)
    }
  }
  const postIssues = graphIssues([...post.values()], canonical.storeId)
  // Compute the component in the union of the old and proposed graphs.
  // A references target enters the set for existence checks only. It does not expand the set.
  const referenceTargets = new Set<string>()
  changed = true
  while (changed) {
    changed = false
    const add = (id: string, viaReference = false) => {
      // Deleted documents were checked when deleted; graph rules still see their metadata.
      if (!nodes.has(id) || nodes.get(id)!.status === 'deleted') return
      if (!affected.has(id)) {
        affected.add(id)
        if (viaReference) referenceTargets.add(id)
        changed = true
      } else if (!viaReference && referenceTargets.delete(id)) {
        changed = true
      }
    }
    const expands = (id: string) =>
      affected.has(id) && !referenceTargets.has(id)
    const tasks = new Set(
      [...affected]
        .filter(id => !referenceTargets.has(id))
        .flatMap(id => [
          ...(nodes.get(id)?.taskIds ?? []),
          ...(post.get(id)?.taskIds ?? [])
        ])
    )
    for (const node of [...current, ...post.values()]) {
      for (const target of [
        ...node.revisionOf,
        ...node.relations
          .filter(r => r.kind !== 'references')
          .map(r => r.targetId)
      ]) {
        if (expands(node.id)) add(target)
        if (expands(target)) add(node.id)
      }
      if (expands(node.id)) {
        for (const relation of node.relations.filter(
          r => r.kind === 'references'
        )) {
          add(relation.targetId, true)
        }
      }
      // An accepted document of the same task is context only: it does not expand the set (ADR 0119).
      if (
        node.status === 'accepted' &&
        node.taskIds.some(id => tasks.has(id))
      ) {
        add(node.id, true)
      }
    }
  }
  // An old issue in an unrelated part of the store does not block this change set.
  const before = new Set(graphIssues(current, canonical.storeId).map(issueKey))
  errors.push(
    ...postIssues.filter(
      issue =>
        !before.has(issueKey(issue)) ||
        issue.artifactIds.some(id => affected.has(id))
    )
  )
  for (const expected of canonical.expectedVersions) {
    if (nodes.get(expected.id)?.metadataVersion !== expected.version) {
      error(
        'stale_version',
        [expected.id],
        'Expected artifact version no longer matches.'
      )
    }
  }
  for (const id of affected) {
    if (
      nodes.has(id) &&
      !canonical.expectedVersions.some(expected => expected.id === id)
    ) {
      error(
        'missing_expected_version',
        [id],
        'The affected artifact needs an expected version.'
      )
    }
  }
  // Superseded documents can never be restored by editing a proposed status.
  for (const node of post.values()) {
    if (
      (nodes.get(node.id)?.status === 'superseded' ||
        previouslySuperseded.has(node.id)) &&
      ['draft', 'in_review', 'accepted'].includes(node.status)
    ) {
      error(
        'invalid_restore',
        [node.id],
        'A superseded artifact requires a new revision.'
      )
    }
  }
  return {
    canonical,
    changeDigest: sha256Hex(canonicalJson(canonical)),
    affectedIds: [...affected].sort(),
    requiredSupplementDispositions: [...required].sort(),
    expectedVersions: [...affected]
      .filter(id => nodes.has(id))
      .sort()
      .map(id => ({ id, version: nodes.get(id)!.metadataVersion })),
    errors,
    postState: [...post.values()]
      .filter(node => affected.has(node.id))
      .sort((a, b) => a.id.localeCompare(b.id)),
    includedIn
  }
}

function issueKey(issue: GraphIssue): string {
  return canonicalJson([issue.code, issue.artifactIds])
}

function isAncestor(
  id: string,
  artifact: Artifact,
  nodes: Map<string, Artifact>
): boolean {
  const visited = new Set<string>()
  let parent = artifact.revisionOf[0]
  while (parent && !visited.has(parent)) {
    if (parent === id) return true
    visited.add(parent)
    parent = nodes.get(parent)?.revisionOf[0] ?? ''
  }
  return false
}
