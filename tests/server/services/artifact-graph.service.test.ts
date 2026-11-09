import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse } from 'yaml'
import { randomUUID } from 'node:crypto'
import {
  createTestDatabase,
  createFileDatabase
} from '../../../src/server/db/index.ts'
import { applyMigrations } from '../../../src/server/db/migrations.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'
import {
  previewArtifactChangeSet,
  artifactIssues,
  graphIssues,
  graphIssuesMessage
} from '../../../src/server/services/artifact-graph-validation.ts'
import {
  ArtifactConflictError,
  ArtifactInputError,
  ArtifactNotFoundError
} from '../../../src/server/errors/artifacts.ts'
import { createEventBus } from '../../../src/server/event-bus.ts'
import { createSessionRegistry } from '../../../src/server/services/agent/session-registry.ts'
import type {
  Artifact,
  ArtifactActor,
  ArtifactChangeSet,
  ArtifactMetadataInput
} from '../../../src/shared/artifacts/types.ts'

// Stable actor identity makes request replay independent of call order.
const ACTOR: ArtifactActor = { kind: 'user', id: 'local' }

function setup(t: TestContext, file = false) {
  const root = mkdtempSync(join(tmpdir(), 'ght-graph-'))
  const path = join(root, '.githuman/ght-reviews.db')
  const db = file ? createFileDatabase(path) : createTestDatabase()
  const eventBus = createEventBus()
  const storage = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    eventBus
  })
  t.after(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  const create = (
    requestId: string,
    metadata: Partial<ArtifactMetadataInput> = {},
    revisionOf: string[] = []
  ) =>
    storage.create(
      {
        requestId,
        body: '# Original\r\nText\n',
        metadata: { title: requestId, tags: [], ...metadata },
        revisionOf
      },
      ACTOR
    )
  return { root, path, db, storage, create, eventBus }
}

function fixture(
  status: Artifact['status'] = 'draft',
  extra: Partial<Artifact> = {}
): Artifact {
  return {
    storeId: '11111111-1111-4111-8111-111111111111',
    id: randomUUID(),
    title: 'Fixture',
    tags: [],
    typeId: 'generic',
    taskIds: [],
    relations: [],
    revisionOf: [],
    status,
    sha256: 'a'.repeat(64),
    bytes: 1,
    bodyStartLine: 1,
    createdAt: '2026-10-27T00:00:00.000Z',
    metadataVersion: 1,
    metadataUpdatedAt: '2026-10-27T00:00:00.000Z',
    ...extra
  }
}
function change(nodes: Artifact[], subject: Artifact): ArtifactChangeSet {
  return {
    storeId: subject.storeId,
    command: 'accept',
    subjectIds: [subject.id],
    expectedVersions: nodes.map(node => ({
      id: node.id,
      version: node.metadataVersion
    })),
    relationChanges: [],
    targetStatuses: [{ artifactId: subject.id, status: 'accepted' }],
    supplementDispositions: [],
    reason: 'Replace the earlier decision'
  }
}

test('type seed is repeatable, deactivation preserves documents and history', t => {
  const { root, db, storage, create } = setup(t)
  assert.equal(storage.types.list().items.length, 9)
  const artifact = create('typed', { typeId: 'plan' })
  const initialEpoch = storage.catalog.epoch()
  storage.types.update(
    'plan',
    'disable-plan',
    1,
    { label: 'Implementation plan', active: false },
    ACTOR
  )
  assert.equal(storage.catalog.epoch(), initialEpoch + 1)
  assert.equal(storage.get(artifact.id).typeId, 'plan')
  assert.throws(() => create('new-plan', { typeId: 'plan' }), /inactive/)
  storage.updateMetadata(
    artifact.id,
    {
      requestId: 'rename',
      expectedVersion: 1,
      metadata: { title: 'Renamed', tags: [] }
    },
    ACTOR
  )
  assert.equal(storage.types.history('plan').length, 2)
  const reopened = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  assert.equal(reopened.types.list().items.length, 9)
  assert.equal(reopened.types.get('plan').active, false)
  assert.equal(reopened.types.history('plan').length, 2)
  const custom = storage.types.create(
    'custom',
    'decision_record',
    { label: 'Decision', active: true },
    ACTOR
  )
  assert.equal(custom.version, 1)
  assert.throws(
    () =>
      storage.types.update(
        custom.id,
        'stale-type',
        2,
        { label: 'Other', active: true },
        ACTOR
      ),
    ArtifactConflictError
  )
})

test('tasks are versioned, idempotent, store scoped and independent of artifacts', t => {
  const { storage, create } = setup(t)
  const input = {
    title: 'Task',
    externalUrl: 'https://example.org/issues/123',
    state: 'open' as const
  }
  const task = storage.tasks.create('task', input, ACTOR)
  assert.deepEqual(
    storage.tasks.create('task', { ...input }, { id: 'local', kind: 'user' }),
    task
  )
  const other = storage.tasks.create(
    'other',
    { ...input, title: 'Other' },
    ACTOR
  )
  const artifact = create('multi-task', { taskIds: [task.id, other.id] })
  assert.equal(storage.list().items.length, 1)
  assert.deepEqual(storage.get(artifact.id).taskIds, [task.id, other.id])
  storage.tasks.update(
    task.id,
    'close',
    1,
    { ...input, state: 'closed' },
    ACTOR
  )
  assert.equal(storage.get(artifact.id).status, 'draft')
  assert.equal(storage.tasks.history(task.id).length, 2)
  assert.throws(
    () => storage.tasks.update(task.id, 'stale', 1, input, ACTOR),
    ArtifactConflictError
  )
  assert.throws(
    () => storage.tasks.create('task', { ...input, title: 'Changed' }, ACTOR),
    ArtifactConflictError
  )
  assert.throws(
    () =>
      storage.tasks.create(
        'bad-url',
        { ...input, externalUrl: 'https://user:pass@example.org' },
        ACTOR
      ),
    ArtifactInputError
  )
  assert.throws(
    () =>
      storage.tasks.create(
        'bad-protocol',
        { ...input, externalUrl: 'file:///tmp' },
        ACTOR
      ),
    ArtifactInputError
  )
  assert.throws(
    () => create('missing-task', { taskIds: [randomUUID()] }),
    ArtifactInputError
  )
  assert.throws(
    () => create('missing-type', { typeId: 'unknown' }),
    /Unknown artifact type/
  )
  assert.throws(() => create('task'), ArtifactConflictError)
  assert.throws(
    () => storage.tasks.create('multi-task', input, ACTOR),
    ArtifactConflictError
  )
})

test('frontmatter stores graph fields once; metadata updates cannot change bytes or lineage', t => {
  const { root, storage, create } = setup(t)
  const parent = create('parent')
  const task = storage.tasks.create(
    'task',
    { title: 'Task', externalUrl: null, state: 'open' },
    ACTOR
  )
  const child = create(
    'revision',
    {
      typeId: 'review',
      taskIds: [task.id],
      relations: [{ kind: 'parent', targetId: parent.id }]
    },
    [parent.id]
  )
  const path = join(root, '.githuman/artifacts', `ght-${child.id}.md`)
  const bytes = readFileSync(path)
  const header = parse(bytes.toString().split('---\n')[1])
  assert.equal(header.type_id, 'review')
  assert.deepEqual(header.task_ids, [task.id])
  assert.deepEqual(header.revision_of, [parent.id])
  assert.deepEqual(header.relations, [{ kind: 'parent', target_id: parent.id }])
  storage.updateMetadata(
    child.id,
    {
      requestId: 'update-relations',
      expectedVersion: 1,
      metadata: { title: 'Updated', tags: [], relations: [] }
    },
    ACTOR
  )
  assert.deepEqual(storage.graph.ancestry(child.id).ancestorIds, [parent.id])
  assert.deepEqual(readFileSync(path), bytes)
  assert.deepEqual(storage.get(child.id).revisionOf, [parent.id])
  assert.deepEqual(storage.history(child.id).items[0].metadata.relations, [
    { kind: 'parent', targetId: parent.id }
  ])
  assert.throws(
    () =>
      storage.updateMetadata(
        child.id,
        {
          requestId: 'rewrite-lineage',
          expectedVersion: 2,
          metadata: {
            title: 'Invalid',
            tags: [],
            revisionOf: []
          } as ArtifactMetadataInput
        },
        ACTOR
      ),
    ArtifactInputError
  )
})

for (const kind of ['parent', 'replaces', 'supplements'] as const) {
  test(`${kind} cycles and self links fail atomically`, t => {
    const { storage, create } = setup(t)
    const a = create('a')
    const b = create('b', { relations: [{ kind, targetId: a.id }] })
    const epoch = storage.catalog.epoch()
    assert.throws(
      () =>
        storage.updateMetadata(
          a.id,
          {
            requestId: 'cycle',
            expectedVersion: 1,
            metadata: {
              title: 'Cycle',
              tags: [],
              relations: [{ kind, targetId: b.id }]
            }
          },
          ACTOR
        ),
      /cycle/
    )
    assert.throws(
      () =>
        storage.updateMetadata(
          a.id,
          {
            requestId: 'self',
            expectedVersion: 1,
            metadata: {
              title: 'Self',
              tags: [],
              relations: [{ kind, targetId: a.id }]
            }
          },
          ACTOR
        ),
      /itself/
    )
    assert.equal(storage.catalog.epoch(), epoch)
    assert.equal(storage.history(a.id).items.length, 1)
  })
}

test('mixed priority cycles fail, while reference cycles and independent graphs are valid', t => {
  const { storage, create } = setup(t)
  const a = create('a')
  const b = create('b', { relations: [{ kind: 'replaces', targetId: a.id }] })
  assert.throws(
    () =>
      storage.updateMetadata(
        a.id,
        {
          requestId: 'mixed-cycle',
          expectedVersion: 1,
          metadata: {
            title: 'A',
            tags: [],
            relations: [{ kind: 'supplements', targetId: b.id }]
          }
        },
        ACTOR
      ),
    /priority graph contains a cycle/
  )
  storage.updateMetadata(
    a.id,
    {
      requestId: 'hierarchy',
      expectedVersion: 1,
      metadata: {
        title: 'A',
        tags: [],
        relations: [
          { kind: 'parent', targetId: b.id },
          { kind: 'references', targetId: b.id }
        ]
      }
    },
    ACTOR
  )
  storage.updateMetadata(
    b.id,
    {
      requestId: 'reference',
      expectedVersion: 1,
      metadata: {
        title: 'B',
        tags: [],
        relations: [
          { kind: 'replaces', targetId: a.id },
          { kind: 'references', targetId: a.id }
        ]
      }
    },
    ACTOR
  )
  assert.deepEqual(storage.graph.ancestry(b.id).ancestorIds, [])
  const edges = storage.graph.relations(a.id, { direction: 'incoming' }).items
  assert.equal(edges.length, 2)
})

test('relations reject duplicates, absent targets and targets from another store', t => {
  const { create, root, db } = setup(t)
  const a = create('a')
  assert.throws(
    () =>
      create('duplicate', {
        relations: [
          { kind: 'references', targetId: a.id },
          { kind: 'references', targetId: a.id }
        ]
      }),
    /Duplicate/
  )
  assert.throws(
    () =>
      create('missing', {
        relations: [{ kind: 'references', targetId: randomUUID() }]
      }),
    /absent/
  )
  const other = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'other-'
  })
  const foreign = other.create(
    {
      requestId: 'foreign',
      body: 'Foreign',
      metadata: { title: 'Foreign', tags: [] }
    },
    ACTOR
  )
  assert.throws(
    () =>
      create('cross-store', {
        relations: [{ kind: 'parent', targetId: foreign.id }]
      }),
    /absent/
  )
  assert.throws(
    () => create('foreign-revision', {}, [foreign.id]),
    /predecessor/
  )
})

test('multiple parents and graph pages retain query identity and invalidate on task updates', t => {
  const { storage, create } = setup(t)
  const a = create('a'),
    b = create('b')
  const child = create('child', {
    relations: [
      { kind: 'parent', targetId: a.id },
      { kind: 'parent', targetId: b.id }
    ]
  })
  const first = storage.graph.relations(child.id, { limit: 1 })
  const second = storage.graph.relations(child.id, {
    limit: 1,
    cursor: first.nextCursor!
  })
  assert.equal(first.items.length, 1)
  assert.equal(second.items.length, 1)
  assert.equal(second.nextCursor, null)
  assert.notEqual(first.items[0].targetId, second.items[0].targetId)
  assert.throws(
    () =>
      storage.graph.relations(a.id, { limit: 1, cursor: first.nextCursor! }),
    /cursor/
  )
  storage.tasks.create(
    'task',
    { title: 'Task', state: 'open', externalUrl: null },
    ACTOR
  )
  assert.throws(
    () =>
      storage.graph.relations(child.id, {
        limit: 1,
        cursor: first.nextCursor!
      }),
    ArtifactConflictError
  )
  const typePage = storage.types.list(1)
  assert.throws(() => storage.tasks.list(1, typePage.nextCursor!), /cursor/)
})

test('metadata concurrency and dictionary epochs remain monotonic across SQLite connections', t => {
  const { root, path, storage, create } = setup(t, true)
  const db2 = createFileDatabase(path)
  t.after(() => db2.close())
  const other = new ArtifactStorageService({
    db: db2,
    repositoryPath: root,
    prefix: 'ght-'
  })
  const a = create('a'),
    b = create('b')
  const before = storage.catalog.epoch()
  other.types.update(
    'plan',
    'type-change',
    1,
    { label: 'Plan changed', active: true },
    ACTOR
  )
  const typeEpoch = storage.catalog.epoch()
  assert.ok(typeEpoch > before)
  storage.updateMetadata(
    a.id,
    {
      requestId: 'links',
      expectedVersion: 1,
      metadata: {
        title: 'A',
        tags: [],
        relations: [{ kind: 'parent', targetId: b.id }]
      }
    },
    ACTOR
  )
  assert.ok(storage.catalog.epoch() > typeEpoch)
  assert.throws(
    () =>
      other.updateMetadata(
        a.id,
        {
          requestId: 'stale',
          expectedVersion: 1,
          metadata: { title: 'Other', tags: [] }
        },
        ACTOR
      ),
    ArtifactConflictError
  )
  assert.throws(
    () =>
      other.updateMetadata(
        b.id,
        {
          requestId: 'cycle',
          expectedVersion: 1,
          metadata: {
            title: 'B',
            tags: [],
            relations: [{ kind: 'parent', targetId: a.id }]
          }
        },
        ACTOR
      ),
    /cycle/
  )
  const expected = storage.catalog.epoch()
  applyMigrations(db2)
  storage.catalog.rebuild()
  assert.equal(storage.catalog.epoch(), expected)
  storage.catalog.transaction(() => storage.definitions.rebuild())
  assert.equal(storage.types.get('plan').label, 'Plan changed')
})

test('dictionary changes rollback history, operations and epoch together', t => {
  const { storage, db } = setup(t)
  const epoch = storage.catalog.epoch()
  db.exec(
    `CREATE TRIGGER fail_store_change BEFORE INSERT ON artifact_store_changes BEGIN SELECT RAISE(ABORT,'simulated journal failure'); END`
  )
  assert.throws(
    () =>
      storage.tasks.create(
        'task',
        { title: 'Task', externalUrl: null, state: 'open' },
        ACTOR
      ),
    /journal failure/
  )
  assert.equal(storage.tasks.list().items.length, 0)
  assert.equal(
    db.prepare('SELECT count(*) count FROM task_versions').get()!.count,
    0
  )
  assert.equal(storage.catalog.epoch(), epoch)
  db.exec('DROP TRIGGER fail_store_change')
  assert.equal(
    storage.tasks.create(
      'task',
      { title: 'Task', externalUrl: null, state: 'open' },
      ACTOR
    ).version,
    1
  )
})

test('new authoritative tables reject UPDATE, DELETE and conflicting REPLACE', t => {
  const { storage, create, db } = setup(t)
  const a = create('a')
  create('b', {}, [a.id])
  storage.tasks.create(
    'task',
    { title: 'Task', externalUrl: null, state: 'open' },
    ACTOR
  )
  for (const table of [
    'artifact_store_changes',
    'artifact_revision_parents',
    'artifact_definition_operations',
    'artifact_type_versions',
    'task_versions'
  ]) {
    const before = db.prepare(`SELECT * FROM ${table}`).all()
    assert.ok(before.length)
    assert.throws(
      () => db.exec(`UPDATE ${table} SET store_id=store_id`),
      /immutable/
    )
    assert.throws(() => db.exec(`DELETE FROM ${table}`), /immutable/)
    assert.throws(
      () =>
        db.exec(
          `INSERT OR REPLACE INTO ${table} SELECT * FROM ${table} LIMIT 1`
        ),
      /immutable/
    )
    assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), before)
  }
})

test('task session links preserve title and history after unlink, deletion and restart', t => {
  const { storage, root, db } = setup(t)
  const registry = createSessionRegistry({
    presets: [
      {
        id: 'fake',
        title: 'Fake',
        autoApprovesEdits: false,
        command: process.execPath,
        args: ['-e', 'process.exit(0)']
      }
    ],
    repositoryPath: root,
    taskIds: id => storage.definitions.assignment(id).taskIds
  })
  t.after(() => registry.closeAll())
  storage.tasks.attachSessions(registry)
  const session = registry.create('fake', null, 'Original title')
  const task = storage.tasks.create(
    'task',
    { title: 'Task', state: 'open', externalUrl: null },
    ACTOR
  )
  const assignment = {
    requestId: 'assign',
    expectedVersion: 0,
    taskIds: [task.id]
  }
  storage.tasks.assignSession(session.id, assignment, ACTOR)
  assert.deepEqual(registry.list()[0].taskIds, [task.id])
  assert.deepEqual(
    storage.tasks.assignSession(session.id, assignment, ACTOR).taskIds,
    [task.id]
  )
  assert.throws(
    () =>
      storage.tasks.assignSession(
        session.id,
        { ...assignment, requestId: 'stale' },
        ACTOR
      ),
    ArtifactConflictError
  )
  storage.tasks.assignSession(
    session.id,
    { requestId: 'unlink', expectedVersion: 1, taskIds: [] },
    ACTOR
  )
  assert.equal(storage.tasks.links(task.id)[0].linked, false)
  assert.equal(storage.tasks.linkHistory(task.id).length, 2)
  registry.close(session.id)
  assert.equal(storage.tasks.links(task.id)[0].available, false)
  assert.equal(storage.tasks.links(task.id)[0].title, 'Original title')
  const restarted = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  assert.equal(restarted.tasks.links(task.id)[0].available, false)
  assert.equal(restarted.tasks.get(task.id).state, 'open')
  assert.throws(() => db.exec('DELETE FROM task_chat_link_events'), /immutable/)
})

test('full replacement requires explicit decisions for every active supplement', () => {
  const old = fixture('accepted'),
    other = fixture('accepted')
  const supplement = fixture('accepted', {
    relations: [{ kind: 'supplements', targetId: old.id }]
  })
  const nested = fixture('accepted', {
    relations: [{ kind: 'supplements', targetId: supplement.id }]
  })
  const candidate = fixture('in_review', {
    relations: [
      { kind: 'replaces', targetId: old.id },
      { kind: 'replaces', targetId: other.id }
    ]
  })
  const nodes = [old, other, supplement, nested, candidate]
  const input = change(nodes, candidate)
  const missing = previewArtifactChangeSet(nodes, input)
  assert.deepEqual(
    new Set(missing.requiredSupplementDispositions),
    new Set([supplement.id, nested.id])
  )
  assert.equal(
    missing.errors.filter(
      issue => issue.code === 'missing_supplement_disposition'
    ).length,
    2
  )
  input.supplementDispositions = [
    { artifactId: supplement.id, disposition: 'incorporated' },
    {
      artifactId: nested.id,
      disposition: 'carry_forward',
      newBaseId: candidate.id
    }
  ]
  const result = previewArtifactChangeSet(nodes, input)
  assert.deepEqual(result.errors, [])
  assert.equal(
    result.postState.find(node => node.id === old.id)!.status,
    'superseded'
  )
  assert.equal(
    result.postState.find(node => node.id === other.id)!.status,
    'superseded'
  )
  assert.equal(
    result.postState.find(node => node.id === supplement.id)!.status,
    'archived'
  )
  assert.deepEqual(
    result.postState.find(node => node.id === nested.id)!.relations,
    [{ kind: 'supplements', targetId: candidate.id }]
  )
  assert.deepEqual(result.includedIn, [
    { artifactId: supplement.id, targetId: candidate.id }
  ])
  assert.equal(old.status, 'accepted')
  assert.equal(candidate.status, 'in_review')
})

test('obsolete dispositions require an explicit inactive status; invalid carry-forward fails', () => {
  const old = fixture('accepted')
  const supplement = fixture('accepted', {
    relations: [{ kind: 'supplements', targetId: old.id }]
  })
  const candidate = fixture('in_review', {
    relations: [{ kind: 'replaces', targetId: old.id }]
  })
  const nodes = [old, supplement, candidate],
    input = change(nodes, candidate)
  input.supplementDispositions = [
    { artifactId: supplement.id, disposition: 'obsolete' }
  ]
  assert.ok(
    previewArtifactChangeSet(nodes, input).errors.some(
      issue => issue.code === 'invalid_disposition'
    )
  )
  input.supplementDispositions = [
    {
      artifactId: supplement.id,
      disposition: 'obsolete',
      targetStatus: 'archived'
    }
  ]
  assert.deepEqual(previewArtifactChangeSet(nodes, input).errors, [])
  input.supplementDispositions = [
    {
      artifactId: supplement.id,
      disposition: 'carry_forward',
      newBaseId: old.id
    }
  ]
  assert.ok(
    previewArtifactChangeSet(nodes, input).errors.some(
      issue => issue.code === 'invalid_disposition'
    )
  )
})

test('canonical changesets ignore key and set order; preview rejects stale versions and graph cycles', () => {
  const a = fixture(),
    b = fixture(),
    candidate = fixture('in_review', {
      relations: [
        { kind: 'references', targetId: a.id },
        { kind: 'parent', targetId: b.id }
      ]
    })
  const nodes = [a, b, candidate],
    input = change(nodes, candidate)
  input.relationChanges = [
    { artifactId: candidate.id, relations: candidate.relations }
  ]
  const first = previewArtifactChangeSet(nodes, input)
  const reordered = {
    ...input,
    expectedVersions: [...input.expectedVersions].sort((left, right) =>
      right.id.localeCompare(left.id)
    ),
    relationChanges: [
      {
        artifactId: candidate.id,
        relations: [...candidate.relations].sort((left, right) =>
          right.targetId.localeCompare(left.targetId)
        )
      }
    ]
  }
  assert.equal(
    previewArtifactChangeSet(nodes, reordered).changeDigest,
    first.changeDigest
  )
  input.expectedVersions[0].version = 2
  assert.ok(
    previewArtifactChangeSet(nodes, input).errors.some(
      issue => issue.code === 'stale_version'
    )
  )
  input.relationChanges.push({
    artifactId: b.id,
    relations: [{ kind: 'parent', targetId: candidate.id }]
  })
  assert.ok(
    previewArtifactChangeSet(nodes, input).errors.some(
      issue => issue.code === 'hierarchy_cycle'
    )
  )
})

test('revision ancestors are independent of parent and references, with draft predecessors retained until acceptance', t => {
  const { storage, create } = setup(t)
  const a = create('a'),
    b = create('b', {}, [a.id]),
    c = create('c', { relations: [{ kind: 'references', targetId: a.id }] }, [
      b.id
    ])
  assert.deepEqual(storage.graph.ancestry(c.id).ancestorIds, [b.id, a.id])
  assert.equal(storage.get(a.id).status, 'draft')
  assert.equal(storage.get(b.id).status, 'draft')
  const accepted = fixture('accepted'),
    revision = fixture('draft', { revisionOf: [accepted.id] })
  assert.ok(
    graphIssues([accepted, revision], accepted.storeId).some(
      issue => issue.code === 'missing_revision_priority'
    )
  )
  const cyclicA = fixture(),
    cyclicB = fixture()
  cyclicA.revisionOf = [cyclicB.id]
  cyclicB.revisionOf = [cyclicA.id]
  assert.ok(
    graphIssues([cyclicA, cyclicB], cyclicA.storeId).some(
      issue => issue.code === 'lineage_cycle'
    )
  )
})

test('preview never writes snapshots, status, events or epoch', t => {
  const { storage, create, db } = setup(t)
  const artifact = create('draft')
  const input = change([artifact], artifact)
  const before = db.prepare('SELECT * FROM artifact_events').all()
  const epoch = storage.catalog.epoch()
  const preview = storage.graph.previewChangeSet(input)
  assert.deepEqual(preview.errors, [])
  assert.equal(storage.get(artifact.id).status, 'draft')
  assert.deepEqual(db.prepare('SELECT * FROM artifact_events').all(), before)
  assert.equal(storage.catalog.epoch(), epoch)
})

test('explicit supersession agrees with derived replacements and cannot retire an unrelated document', () => {
  const old = fixture('accepted'),
    unrelated = fixture('accepted')
  const candidate = fixture('in_review', {
    relations: [{ kind: 'replaces', targetId: old.id }]
  })
  const nodes = [old, unrelated, candidate],
    input = change(nodes, candidate)
  input.targetStatuses.push({ artifactId: old.id, status: 'superseded' })
  assert.deepEqual(previewArtifactChangeSet(nodes, input).errors, [])
  input.targetStatuses.push({ artifactId: unrelated.id, status: 'superseded' })
  assert.ok(
    previewArtifactChangeSet(nodes, input).errors.some(
      issue => issue.code === 'invalid_supersession'
    )
  )
  input.targetStatuses = [
    { artifactId: candidate.id, status: 'accepted' },
    { artifactId: old.id, status: 'archived' }
  ]
  assert.ok(
    previewArtifactChangeSet(nodes, input).errors.some(
      issue => issue.code === 'conflicting_target_status'
    )
  )
})

test('ancestry, definition history and session history use cursors without truncating chains', t => {
  const { storage, create } = setup(t)
  const first = create('first'),
    second = create('second', {}, [first.id]),
    third = create('third', {}, [second.id])
  const page = storage.graph.ancestry(third.id, 1)
  assert.deepEqual(page.ancestorIds, [second.id])
  assert.ok(page.nextCursor)
  const last = storage.graph.ancestry(third.id, 1, page.nextCursor)
  assert.deepEqual(last.ancestorIds, [first.id])
  assert.equal(last.nextCursor, null)
  storage.types.update(
    'plan',
    'type-update',
    1,
    { label: 'Updated plan', active: true },
    ACTOR
  )
  const history = storage.types.historyPage('plan', 1)
  assert.equal(history.items[0].snapshot.version, 1)
  assert.equal(
    storage.types.historyPage('plan', 1, history.nextCursor!).items[0].snapshot
      .version,
    2
  )
  assert.throws(
    () => storage.graph.ancestry(third.id, 1, page.nextCursor!),
    ArtifactConflictError
  )
  assert.throws(
    () =>
      storage.types.update(
        'plan',
        'seed:type:plan',
        2,
        { label: 'Other', active: true },
        ACTOR
      ),
    ArtifactConflictError
  )
})

test('recovery retains reserved graph metadata and inserts immutable lineage once', t => {
  const { storage, create, root, db } = setup(t)
  const parent = create('parent')
  const task = storage.tasks.create(
    'task',
    { title: 'Task', externalUrl: null, state: 'open' },
    ACTOR
  )
  let now = Date.now()
  const input = {
    requestId: 'crash',
    body: 'Revision',
    metadata: {
      title: 'Revision',
      tags: [],
      typeId: 'plan',
      taskIds: [task.id],
      relations: [{ kind: 'parent' as const, targetId: parent.id }]
    },
    revisionOf: [parent.id]
  }
  const writer = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    now: () => now,
    checkpoint: phase => {
      if (phase === 'temp_synced') throw new Error('crash')
    }
  })
  assert.throws(() => writer.create(input, ACTOR), /crash/)
  const operation = writer.catalog.operation('crash')!
  storage.types.update(
    'plan',
    'deactivate',
    1,
    { label: 'Plan', active: false },
    ACTOR
  )
  now += 31_000
  const restarted = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    now: () => now
  })
  assert.deepEqual(restarted.recover().recovered, [operation.artifactId])
  assert.deepEqual(restarted.graph.ancestry(operation.artifactId).ancestorIds, [
    parent.id
  ])
  assert.deepEqual(restarted.get(operation.artifactId).taskIds, [task.id])
  assert.equal(restarted.create(input, ACTOR).id, operation.artifactId)
  assert.equal(restarted.history(operation.artifactId).items.length, 1)
  assert.equal(
    db
      .prepare(
        'SELECT count(*) count FROM artifact_revision_parents WHERE child_id=?'
      )
      .get(operation.artifactId)!.count,
    1
  )
})

const codes = (result: { errors: { code: string }[] }) =>
  result.errors.map(issue => issue.code)

test('update_relations cannot change statuses', () => {
  const draft = fixture('in_review')
  const nodes = [draft]
  const input: ArtifactChangeSet = {
    ...change(nodes, draft),
    command: 'update_relations'
  }
  const result = previewArtifactChangeSet(nodes, input)
  assert.ok(codes(result).includes('status_not_allowed_for_command'))
})

test('empty update_relations change sets are rejected', () => {
  const node = fixture('accepted')
  const input: ArtifactChangeSet = {
    ...change([node], node),
    command: 'update_relations',
    targetStatuses: []
  }
  assert.ok(
    codes(previewArtifactChangeSet([node], input)).includes('empty_change_set')
  )
})

test('command policy limits target statuses to the subjects and derived supersession', () => {
  const subject = fixture('accepted')
  const other = fixture('accepted')
  const nodes = [subject, other]
  const archive: ArtifactChangeSet = {
    ...change(nodes, subject),
    command: 'archive',
    targetStatuses: [
      { artifactId: subject.id, status: 'archived' },
      { artifactId: other.id, status: 'archived' }
    ]
  }
  assert.ok(
    codes(previewArtifactChangeSet(nodes, archive)).includes(
      'status_not_allowed_for_command'
    )
  )
  const wrong: ArtifactChangeSet = {
    ...archive,
    targetStatuses: [{ artifactId: subject.id, status: 'deleted' }]
  }
  assert.ok(
    codes(previewArtifactChangeSet(nodes, wrong)).includes(
      'status_not_allowed_for_command'
    )
  )
  const valid: ArtifactChangeSet = {
    ...archive,
    targetStatuses: [{ artifactId: subject.id, status: 'archived' }]
  }
  assert.deepEqual(previewArtifactChangeSet(nodes, valid).errors, [])
})

test('a status cannot repeat a supplement disposition', () => {
  const base = fixture('accepted')
  const supplement = fixture('accepted', {
    relations: [{ kind: 'supplements', targetId: base.id }]
  })
  const nodes = [base, supplement]
  const input: ArtifactChangeSet = {
    ...change(nodes, base),
    command: 'archive',
    subjectIds: [base.id],
    targetStatuses: [
      { artifactId: base.id, status: 'archived' },
      { artifactId: supplement.id, status: 'archived' }
    ],
    supplementDispositions: [
      {
        artifactId: supplement.id,
        disposition: 'obsolete',
        targetStatus: 'archived'
      }
    ]
  }
  assert.ok(
    codes(previewArtifactChangeSet(nodes, input)).includes(
      'status_duplicates_disposition'
    )
  )
})

test('a new replaces link on an accepted artifact is rejected for every command', () => {
  const first = fixture('accepted')
  const second = fixture('accepted')
  const nodes = [first, second]
  for (const command of ['update_relations', 'accept'] as const) {
    const input: ArtifactChangeSet = {
      ...change(nodes, first),
      command,
      targetStatuses:
        command === 'accept'
          ? [{ artifactId: first.id, status: 'accepted' }]
          : [],
      relationChanges: [
        {
          artifactId: first.id,
          relations: [{ kind: 'replaces', targetId: second.id }]
        }
      ]
    }
    assert.ok(
      codes(previewArtifactChangeSet(nodes, input)).includes(
        'replaces_on_active_artifact'
      ),
      command
    )
  }
})

test('unchanged replaces and other link kinds stay allowed on accepted artifacts', () => {
  const old = fixture('superseded')
  const first = fixture('accepted', {
    relations: [{ kind: 'replaces', targetId: old.id }]
  })
  const second = fixture('accepted')
  const nodes = [old, first, second]
  const input: ArtifactChangeSet = {
    ...change(nodes, first),
    command: 'update_relations',
    targetStatuses: [],
    relationChanges: [
      {
        artifactId: first.id,
        relations: [
          { kind: 'references', targetId: second.id },
          { kind: 'replaces', targetId: old.id }
        ]
      }
    ]
  }
  assert.deepEqual(previewArtifactChangeSet(nodes, input).errors, [])
})

test('the default artifact type cannot be deactivated', t => {
  const { storage, create } = setup(t)
  assert.throws(
    () =>
      storage.types.update(
        'generic',
        'off',
        1,
        { label: 'Generic', active: false },
        ACTOR
      ),
    ArtifactInputError
  )
  assert.equal(storage.types.get('generic').active, true)
  assert.equal(create('default').typeId, 'generic')
  assert.equal(
    storage.types.update(
      'generic',
      'rename',
      1,
      { label: 'Any document', active: true },
      ACTOR
    ).label,
    'Any document'
  )
})

test('an unknown task in a session assignment is an input error, an unknown session stays not found', t => {
  const { storage, root } = setup(t)
  const registry = createSessionRegistry({
    presets: [
      {
        id: 'fake',
        title: 'Fake',
        autoApprovesEdits: false,
        command: process.execPath,
        args: ['-e', 'process.exit(0)']
      }
    ],
    repositoryPath: root
  })
  t.after(() => registry.closeAll())
  storage.tasks.attachSessions(registry)
  const session = registry.create('fake', null, 'Chat')
  assert.throws(
    () =>
      storage.tasks.assignSession(
        session.id,
        { requestId: 'bad', expectedVersion: 0, taskIds: [randomUUID()] },
        ACTOR
      ),
    ArtifactInputError
  )
  assert.throws(
    () =>
      storage.tasks.assignSession(
        randomUUID(),
        { requestId: 'none', expectedVersion: 0, taskIds: [] },
        ACTOR
      ),
    ArtifactNotFoundError
  )
})

test('replay accepts reordered task and relation sets', t => {
  const { storage, create } = setup(t)
  const target = create('target')
  const other = create('other')
  const first = storage.tasks.create(
    'task-a',
    { title: 'A', state: 'open', externalUrl: null },
    ACTOR
  )
  const second = storage.tasks.create(
    'task-b',
    { title: 'B', state: 'open', externalUrl: null },
    ACTOR
  )
  const links = [
    { kind: 'references', targetId: target.id },
    { kind: 'references', targetId: other.id }
  ] as const
  const created = create('sets', {
    taskIds: [first.id, second.id],
    relations: [...links]
  })
  const replay = create('sets', {
    taskIds: [second.id, first.id],
    relations: [links[1], links[0]]
  })
  assert.deepEqual(replay, created)
  const update = (taskIds: string[], relations: (typeof links)[number][]) =>
    storage.updateMetadata(
      created.id,
      {
        requestId: 'edit-sets',
        expectedVersion: 1,
        metadata: { title: 'sets', tags: [], taskIds, relations }
      },
      ACTOR
    )
  const updated = update([first.id], [links[0]])
  assert.deepEqual(update([first.id], [links[0]]), updated)
  assert.throws(() => update([second.id], [links[0]]), ArtifactConflictError)
})

// Small deterministic generator keeps failing cases reproducible.
function random(seed: number) {
  let state = seed
  return (limit: number) => {
    state = (state * 1103515245 + 12345) % 2147483648
    return Math.floor(state / 65536) % limit
  }
}

const issueCodes = (items: { code: string }[]) =>
  [...new Set(items.map(item => item.code))].sort()

test('incremental write validation agrees with the full graph check', () => {
  const kinds = ['parent', 'replaces', 'supplements', 'references'] as const
  let checked = 0,
    withIssues = 0
  for (let seed = 1; seed <= 300; seed++) {
    const next = random(seed)
    // Build a valid graph: every edge points to an earlier node.
    const nodes: Artifact[] = []
    for (let index = 0; index < 6; index++) {
      const relations: Artifact['relations'] = []
      const seen = new Set<string>()
      const edges = index > 0 ? next(3) : 0
      for (let edge = 0; edge < edges; edge++) {
        const kind = kinds[next(kinds.length)]
        const targetId = nodes[next(index)].id
        if (!seen.has(`${kind}:${targetId}`)) {
          seen.add(`${kind}:${targetId}`)
          relations.push({ kind, targetId })
        }
      }
      const draftParents = nodes.filter(node => node.status === 'draft')
      const parent = draftParents[next(draftParents.length + 1)]
      nodes.push(
        fixture(next(2) ? 'draft' : 'accepted', {
          relations,
          revisionOf: parent && next(2) ? [parent.id] : []
        })
      )
    }
    if (graphIssues(nodes, nodes[0].storeId).length) continue
    // Write one artifact: update a node (keep lineage) or create a new one.
    const update = next(2) === 0
    const picked = nodes[next(nodes.length)]
    const targets = [...nodes.map(node => node.id), picked.id, randomUUID()]
    const relations: Artifact['relations'] = []
    for (let edge = 0; edge < next(4); edge++) {
      relations.push({
        kind: kinds[next(kinds.length)],
        targetId: targets[next(targets.length)]
      })
    }
    const written = update
      ? { ...picked, relations }
      : fixture('draft', {
          relations,
          revisionOf: next(2) ? [targets[next(targets.length)]] : []
        })
    const others = nodes.filter(node => node.id !== written.id)
    const full = graphIssues([...others, written], written.storeId)
    const found = artifactIssues(
      written,
      id => others.find(node => node.id === id),
      written.storeId
    )
    assert.deepEqual(issueCodes(found), issueCodes(full), `seed ${seed}`)
    checked++
    if (full.length) withIssues++
  }
  // The generator must reach both valid and invalid writes.
  assert.ok(
    checked > 100 && withIssues > 20 && withIssues < checked,
    `${checked}/${withIssues}`
  )
})

test('0092: incorporated supplements archive with inclusion audit instead of becoming superseded', () => {
  const base = fixture('accepted')
  const supplement = fixture('accepted', {
    relations: [{ kind: 'supplements', targetId: base.id }]
  })
  const candidate = fixture('in_review', {
    relations: [{ kind: 'replaces', targetId: base.id }]
  })
  const nodes = [base, supplement, candidate],
    input = change(nodes, candidate)
  input.supplementDispositions = [
    { artifactId: supplement.id, disposition: 'incorporated' }
  ]
  const result = previewArtifactChangeSet(nodes, input)
  assert.deepEqual(result.errors, [])
  assert.equal(
    result.postState.find(item => item.id === supplement.id)?.status,
    'archived'
  )
  assert.deepEqual(result.includedIn, [
    { artifactId: supplement.id, targetId: candidate.id }
  ])
  assert.equal(supplement.status, 'accepted')
})

test('0092: accepting two replacements for the same base in one package is rejected', () => {
  const base = fixture('accepted')
  const first = fixture('in_review', {
    relations: [{ kind: 'replaces', targetId: base.id }]
  })
  const second = fixture('in_review', {
    relations: [{ kind: 'replaces', targetId: base.id }]
  })
  const nodes = [base, first, second]
  const input: ArtifactChangeSet = {
    ...change(nodes, first),
    subjectIds: [first.id, second.id],
    targetStatuses: [
      { artifactId: first.id, status: 'accepted' },
      { artifactId: second.id, status: 'accepted' }
    ]
  }
  assert.ok(
    codes(previewArtifactChangeSet(nodes, input)).includes(
      'competing_replacements'
    )
  )
})

test('0092: retired history cannot be bypassed by superseded to archived to deleted to draft', t => {
  const { storage, create } = setup(t)
  const artifact = create('retired')
  for (const status of [
    'in_review',
    'accepted',
    'superseded',
    'archived',
    'deleted'
  ] as const) {
    storage.catalog.transaction(() => {
      const previous = storage.get(artifact.id)
      storage.catalog.appendMetadata(
        { ...previous, status, metadataVersion: previous.metadataVersion + 1 },
        randomUUID(),
        ACTOR,
        'metadata_updated'
      )
    })
  }
  const current = storage.get(artifact.id)
  const input: ArtifactChangeSet = {
    ...change([current], current),
    command: 'restore',
    targetStatuses: [{ artifactId: current.id, status: 'draft' }]
  }
  const before = storage.catalog.epoch()
  assert.ok(
    codes(storage.graph.previewChangeSet(input)).includes('invalid_restore')
  )
  assert.equal(storage.get(artifact.id).status, 'deleted')
  assert.equal(storage.catalog.epoch(), before)
})

test('0097: direct acceptance and legacy transitions have distinct source statuses', () => {
  const cases: [
    Artifact['status'],
    ArtifactChangeSet['command'],
    Artifact['status'],
    boolean
  ][] = [
    ['draft', 'accept', 'accepted', true],
    ['draft', 'update_relations', 'in_review', false],
    ['in_review', 'reject', 'rejected', true],
    ['in_review', 'return_to_draft', 'draft', true],
    ['rejected', 'return_to_draft', 'draft', true],
    ['archived', 'restore', 'draft', true],
    ['deleted', 'restore', 'draft', true],
    ['in_review', 'restore', 'draft', false],
    ['archived', 'return_to_draft', 'draft', false],
    ['rejected', 'accept', 'accepted', false]
  ]
  for (const [status, command, target, valid] of cases) {
    const node = fixture(status)
    const input = change([node], node)
    input.command = command
    input.targetStatuses = [{ artifactId: node.id, status: target }]
    const result = previewArtifactChangeSet([node], input)
    assert.equal(result.errors.length === 0, valid, `${status}: ${command}`)
  }
})

test('incoming relationships stay grouped across pages and reject cursors for the former ordering', t => {
  const { storage, create } = setup(t)
  const target = create('group-target')
  for (let index = 0; index < 4; index++) {
    create(`group-source-${index}`, {
      relations: [
        { kind: 'references', targetId: target.id },
        { kind: 'supplements', targetId: target.id }
      ]
    })
  }
  const items: { kind: string; sourceId: string }[] = []
  let cursor: string | undefined
  do {
    const page = storage.graph.relations(target.id, {
      direction: 'incoming',
      limit: 3,
      cursor
    })
    items.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  assert.deepEqual(
    items.map(item => item.kind),
    [...Array(4).fill('references'), ...Array(4).fill('supplements')]
  )
  assert.equal(
    new Set(items.map(item => `${item.kind}:${item.sourceId}`)).size,
    8
  )
  const oldCursor = Buffer.from(
    JSON.stringify({
      storeId: storage.storeId,
      epoch: storage.catalog.epoch(),
      query: `graph:${target.id}:incoming:`,
      offset: 3
    })
  ).toString('base64url')
  assert.throws(
    () =>
      storage.graph.relations(target.id, {
        direction: 'incoming',
        cursor: oldCursor
      }),
    /Invalid page cursor/
  )
})

test('0110: references targets join the set but do not expand it', () => {
  const far = fixture('draft')
  const farSupplement = fixture('draft', {
    relations: [{ kind: 'supplements', targetId: far.id }]
  })
  const middle = fixture('draft', {
    relations: [{ kind: 'references', targetId: far.id }]
  })
  const unrelated = fixture('draft')
  const subject = fixture('draft', {
    relations: [{ kind: 'references', targetId: middle.id }]
  })
  const nodes = [far, farSupplement, middle, unrelated, subject]
  const result = previewArtifactChangeSet(
    nodes,
    change([subject, middle], subject)
  )
  assert.deepEqual(result.affectedIds, [subject.id, middle.id].sort())
  assert.deepEqual(result.contentRequiredIds, [subject.id])
  assert.equal(result.errors.length, 0)
  const missing = previewArtifactChangeSet(nodes, change([subject], subject))
  assert.deepEqual(
    missing.errors
      .filter(e => e.code === 'missing_expected_version')
      .flatMap(e => e.artifactIds),
    [middle.id]
  )
})

test('0110: a structural link still expands through a reference target', () => {
  const base = fixture('accepted')
  const supplement = fixture('accepted', {
    relations: [{ kind: 'supplements', targetId: base.id }]
  })
  const subject = fixture('draft', {
    relations: [{ kind: 'replaces', targetId: base.id }]
  })
  const result = previewArtifactChangeSet(
    [base, supplement, subject],
    change([base, subject], subject)
  )
  assert.ok(result.affectedIds.includes(base.id))
  assert.ok(result.affectedIds.includes(supplement.id))
})

function missingVersion(id: string) {
  return {
    code: 'missing_expected_version',
    artifactIds: [id],
    message: 'The affected artifact needs an expected version.'
  }
}

test('graph issue message names artifacts, current versions and merges repeats', () => {
  assert.equal(
    graphIssuesMessage(
      [
        missingVersion('a'),
        missingVersion('b'),
        missingVersion('a'),
        { code: 'transition_unavailable', artifactIds: [], message: 'No.' }
      ],
      [
        { id: 'a', version: 2 },
        { id: 'b', version: 1 }
      ]
    ),
    'missing_expected_version [a@v2, b@v1]: The affected artifact needs an expected version. transition_unavailable: No.'
  )
  const many = Array.from({ length: 25 }, (_, index) => ({
    code: `code_${index}`,
    artifactIds: Array.from({ length: 22 }, (__, item) => `id${item}`),
    message: 'Problem.'
  }))
  const text = graphIssuesMessage(many)
  assert.match(text, /code_19 \[id0, .*id19, \+2 more\]/)
  assert.doesNotMatch(text, /code_20/)
  assert.match(text, /5 more issues\. Preview the change set/)
})

test('0119: a general accepted document does not enter the set', () => {
  const general = fixture('accepted')
  const subject = fixture('draft')
  const result = previewArtifactChangeSet(
    [general, subject],
    change([subject], subject)
  )
  assert.deepEqual(result.affectedIds, [subject.id])
  assert.deepEqual(result.errors, [])
})

test('0119: an accepted document of the same task is context and does not expand the set', () => {
  const taskIds = [randomUUID()]
  const decision = fixture('accepted', { taskIds })
  const decisionDraft = fixture('draft', {
    relations: [{ kind: 'supplements', targetId: decision.id }]
  })
  const subject = fixture('draft', { taskIds })
  const result = previewArtifactChangeSet(
    [decision, decisionDraft, subject],
    change([subject, decision], subject)
  )
  assert.deepEqual(result.affectedIds, [decision.id, subject.id].sort())
  assert.deepEqual(result.contentRequiredIds, [subject.id])
  assert.deepEqual(result.errors, [])
})

test('0119: a deleted neighbour does not enter the set', () => {
  const removed = fixture('deleted')
  const subject = fixture('draft', {
    relations: [{ kind: 'parent', targetId: removed.id }]
  })
  const result = previewArtifactChangeSet(
    [removed, subject],
    change([subject], subject)
  )
  assert.deepEqual(result.affectedIds, [subject.id])
})

test('0119: an old issue blocks only when it touches the set', () => {
  const broken = fixture('draft', {
    relations: [{ kind: 'references', targetId: randomUUID() }]
  })
  const subject = fixture('draft')
  const unrelated = previewArtifactChangeSet(
    [broken, subject],
    change([subject], subject)
  )
  assert.deepEqual(unrelated.errors, [])
  const touched = previewArtifactChangeSet(
    [broken, subject],
    change([broken], broken)
  )
  assert.ok(touched.errors.some(error => error.code === 'missing_target'))
})

test('0111: structural paths promote reference targets regardless of traversal order', () => {
  for (const reverse of [false, true]) {
    const target = fixture('draft')
    const bridge = fixture('draft', {
      relations: [{ kind: 'parent', targetId: target.id }]
    })
    const subject = fixture('draft', {
      relations: [
        { kind: 'references', targetId: target.id },
        { kind: 'parent', targetId: bridge.id }
      ]
    })
    const nodes = [target, bridge, subject]
    const result = previewArtifactChangeSet(
      reverse ? [subject, bridge, target] : nodes,
      change(nodes, subject)
    )
    assert.deepEqual(
      result.contentRequiredIds,
      nodes.map(node => node.id).sort()
    )
    assert.deepEqual(result.errors, [])
  }
})

test('0111: removed structural relations still require old content', () => {
  const target = fixture('draft')
  const subject = fixture('draft', {
    relations: [{ kind: 'parent', targetId: target.id }]
  })
  const input = change([target, subject], subject)
  input.relationChanges = [
    {
      artifactId: subject.id,
      relations: [{ kind: 'references', targetId: target.id }]
    }
  ]
  const result = previewArtifactChangeSet([subject, target], input)
  assert.deepEqual(result.contentRequiredIds, [subject.id, target.id].sort())
})
