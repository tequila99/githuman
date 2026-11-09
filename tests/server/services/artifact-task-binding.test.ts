import { previewArtifactChangeSet } from '../../../src/server/services/artifact-graph-validation.ts'
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import {
  ArtifactStorageService,
  type ArtifactCheckpoint
} from '../../../src/server/services/artifact-storage.service.ts'
import {
  ArtifactConflictError,
  ArtifactInputError
} from '../../../src/server/errors/artifacts.ts'
import type { TurnTaskContext } from '../../../src/server/services/agent/turn-task-context.ts'

// Stable actor identity is part of the original request hash.
const ACTOR = { kind: 'agent' as const, id: 'session-a' }

const input = (requestId: string, taskIds?: string[]) => ({
  requestId,
  body: '# Body\n',
  metadata: {
    title: requestId,
    tags: [],
    ...(taskIds === undefined ? {} : { taskIds })
  }
})

function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'ght-task-binding-'))
  const db = createTestDatabase()
  const storage = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  t.after(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  const task = (title: string) =>
    storage.tasks.create(
      'task-' + title,
      { title, externalUrl: null, state: 'open' },
      ACTOR
    ).id
  const a = task('A'),
    b = task('B')
  const turn = (ids: string[], version = 1): TurnTaskContext => ({
    sessionId: ACTOR.id,
    turnId: randomUUID(),
    assignmentVersion: version,
    taskIds: ids
  })

  return { root, db, storage, a, b, turn }
}

test('explicit, inherited, ambiguous and missing task contexts preserve create semantics', t => {
  const { storage, a, b, turn } = setup(t)
  const context = turn([a], 4)
  const inherited = storage.create(input('inherited'), ACTOR, context)
  assert.deepEqual(inherited.taskIds, [a])
  assert.deepEqual(storage.catalog.operation('inherited')?.data.taskBinding, {
    source: 'turn_assignment',
    sessionId: ACTOR.id,
    turnId: context.turnId,
    assignmentVersion: 4
  })
  assert.deepEqual(
    storage.create(input('explicit', [b]), ACTOR, turn([a])).taskIds,
    [b]
  )
  assert.deepEqual(
    storage.create(input('empty', []), ACTOR, turn([a])).taskIds,
    []
  )
  assert.deepEqual(storage.create(input('missing'), ACTOR).taskIds, [])
  assert.deepEqual(storage.create(input('zero'), ACTOR, turn([])).taskIds, [])
  assert.deepEqual(
    storage.create(input('many'), ACTOR, turn([a, b])).taskIds,
    []
  )
  assert.deepEqual(
    storage.create(input('wrong-session'), ACTOR, {
      ...turn([a]),
      sessionId: 'other'
    }).taskIds,
    []
  )
  assert.deepEqual(
    storage.create(input('http'), { kind: 'user', id: 'local' }, turn([a]))
      .taskIds,
    []
  )
  assert.equal(storage.tasks.get(a).state, 'open')
  assert.throws(
    () => storage.create(input('unknown'), ACTOR, turn([randomUUID()])),
    ArtifactInputError
  )
  assert.deepEqual(storage.catalog.operation('empty')?.data.taskBinding, {
    source: 'explicit'
  })
  assert.deepEqual(storage.catalog.operation('many')?.data.taskBinding, {
    source: 'legacy_default'
  })
})

test('replay preserves initial task binding across changed, missing and restarted contexts', t => {
  const { storage, root, db, a, b, turn } = setup(t)
  const original = storage.create(input('retry'), ACTOR, turn([a]))
  assert.deepEqual(
    storage.create(input('retry'), ACTOR, turn([b], 2)),
    original
  )
  assert.deepEqual(storage.create(input('retry'), ACTOR), original)
  const restarted = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  assert.deepEqual(restarted.create(input('retry'), ACTOR, turn([b])), original)
  assert.throws(
    () => restarted.create(input('retry', []), ACTOR),
    ArtifactConflictError
  )
  assert.throws(
    () => restarted.create(input('retry', [a]), ACTOR),
    ArtifactConflictError
  )
  assert.throws(
    () => restarted.create(input('retry'), { kind: 'agent', id: 'other' }),
    ArtifactConflictError
  )
  const explicit = storage.create(
    input('explicit-retry', [b]),
    ACTOR,
    turn([a])
  )
  assert.deepEqual(
    storage.create(input('explicit-retry', [b]), ACTOR),
    explicit
  )
  const legacy = storage.createWithCommit(input('legacy'), ACTOR, () => {})
  assert.deepEqual(legacy.taskIds, [])
  assert.equal(
    storage.catalog.operation('legacy')?.data.taskBinding?.source,
    'legacy_default'
  )
})

for (const phase of [
  'reserved',
  'temp_synced',
  'published',
  'before_commit',
  'after_commit'
] as ArtifactCheckpoint[]) {
  test(`recovery at ${phase} retains the original task snapshot`, t => {
    const { storage, db, root, a, b, turn } = setup(t)
    let now = Date.now()
    const crashed = new ArtifactStorageService({
      db,
      repositoryPath: root,
      prefix: 'ght-',
      now: () => now,
      checkpoint: current => {
        if (current === phase) throw new Error('process stopped')
      }
    })
    const context = turn([a], 7)
    assert.throws(
      () => crashed.create(input('recover'), ACTOR, context),
      /process stopped/
    )
    const operation = storage.catalog.operation('recover')!
    const restarted = new ArtifactStorageService({
      db,
      repositoryPath: root,
      prefix: 'ght-',
      now: () => now
    })
    now += 31_000
    restarted.recover()
    const result = restarted.create(input('recover'), ACTOR, turn([b], 8))
    assert.equal(result.id, operation.artifactId)
    assert.deepEqual(result.taskIds, [a])
    assert.equal(restarted.history(result.id).items.length, 1)
    assert.deepEqual(restarted.catalog.operation('recover')?.data.taskBinding, {
      source: 'turn_assignment',
      sessionId: context.sessionId,
      turnId: context.turnId,
      assignmentVersion: 7
    })
    const bytes = readFileSync(
      join(root, '.githuman/artifacts', `ght-${result.id}.md`),
      'utf8'
    )
    assert.ok(bytes.includes(a))
    assert.ok(!bytes.includes(b))
    restarted.updateMetadata(
      result.id,
      {
        requestId: 'correct',
        expectedVersion: 1,
        metadata: { title: result.title, tags: [], taskIds: [b] }
      },
      ACTOR
    )
    assert.deepEqual(restarted.get(result.id).taskIds, [b])
    assert.equal(
      readFileSync(
        join(root, '.githuman/artifacts', `ght-${result.id}.md`),
        'utf8'
      ),
      bytes
    )
  })
}

test('old operations without binding provenance replay without inheriting a new task', t => {
  const { storage, a, turn } = setup(t)
  const reserve = storage.catalog.reserve.bind(storage.catalog)
  storage.catalog.reserve = (operation, now) => {
    delete operation.data.taskBinding
    return reserve(operation, now)
  }
  const legacy = storage.create(input('old-operation'), ACTOR)
  assert.equal(
    storage.catalog.operation('old-operation')?.data.taskBinding,
    undefined
  )
  assert.deepEqual(
    storage.create(input('old-operation'), ACTOR, turn([a])),
    legacy
  )
  assert.deepEqual(legacy.taskIds, [])
})

test('inherited direct IDs select their validation scope without including a sibling task', t => {
  const { storage, a, b, turn } = setup(t)
  const candidate = storage.create(input('candidate'), ACTOR, turn([a]))
  const same = {
    ...storage.create(input('same', [a]), ACTOR),
    status: 'accepted' as const
  }
  const sibling = {
    ...storage.create(input('sibling', [b]), ACTOR),
    status: 'accepted' as const
  }
  const general = {
    ...storage.create(input('general', []), ACTOR),
    status: 'accepted' as const
  }
  const preview = previewArtifactChangeSet(
    [candidate, same, sibling, general],
    {
      storeId: storage.storeId,
      command: 'accept',
      subjectIds: [candidate.id],
      expectedVersions: [candidate, same, general].map(node => ({
        id: node.id,
        version: node.metadataVersion
      })),
      relationChanges: [],
      targetStatuses: [{ artifactId: candidate.id, status: 'accepted' }],
      supplementDispositions: [],
      reason: 'Verify direct task scope'
    }
  )
  assert.deepEqual(preview.errors, [])
  assert.deepEqual(
    new Set(preview.affectedIds),
    new Set([candidate.id, same.id])
  )
  // ADR 0119: a general accepted document no longer enters every change set.
  assert.ok(!preview.affectedIds.includes(general.id))
  assert.ok(!preview.affectedIds.includes(sibling.id))
})
