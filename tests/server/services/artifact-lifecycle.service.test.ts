import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildApp } from '../../../src/server/app.ts'
import {
  createTestDatabase,
  createFileDatabase
} from '../../../src/server/db/index.ts'
import { applyMigrations } from '../../../src/server/db/migrations.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'
import { ArtifactLifecycleService } from '../../../src/server/services/artifact-lifecycle.service.ts'
import type { AgentSessionRegistry } from '../../../src/server/services/agent/session-registry.ts'
import type {
  Artifact,
  ArtifactChangeSet
} from '../../../src/shared/artifacts/types.ts'

// A fixed user identity exercises the same structured action routes as the browser.
const USER = { kind: 'user' as const, id: 'local' }

async function setup(t: TestContext, file = false) {
  const root = mkdtempSync(join(tmpdir(), 'ght-lifecycle-'))
  const path = join(root, '.githuman/ght-reviews.db')
  const db = file ? createFileDatabase(path) : createTestDatabase()
  let now = Date.now()
  const storage = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    now: () => now
  })
  const sessions = new Map<
    string,
    {
      id: string
      status: string
      onEvent: () => () => void
      prompt: () => void
    }
  >()
  const registry = {
    create() {
      const value = {
        id: randomUUID(),
        status: 'ready',
        onEvent: () => () => {},
        prompt: () => {}
      }
      sessions.set(value.id, value)
      return value
    },
    get(id: string) {
      return sessions.get(id)
    },
    close(id: string) {
      const session = sessions.get(id)
      if (session) session.status = 'closed'
      return true
    },
    notifyArtifactActionsChanged() {}
  } as unknown as AgentSessionRegistry
  storage.lifecycle.attachSessions(registry)
  const app = buildApp({ repositoryPath: root, db, artifacts: storage })
  await app.ready()
  t.after(async () => {
    await app.close()
    db.close()
    rmSync(root, { force: true, recursive: true })
  })
  function create(
    status: Artifact['status'] = 'in_review',
    relations: Artifact['relations'] = [],
    revisionOf: string[] = []
  ) {
    const value = storage.create(
      {
        requestId: randomUUID(),
        body: 'Обязательный текст 🧪\n'.repeat(1000),
        metadata: { title: 'Document', tags: [], relations },
        revisionOf
      },
      USER
    )
    if (status === 'draft') return value
    const next = { ...value, status, metadataVersion: 2 }
    storage.catalog.transaction(() =>
      storage.catalog.appendMetadata(
        next,
        randomUUID(),
        USER,
        'metadata_updated'
      )
    )
    return next
  }
  function propose(
    subjects: Artifact[],
    command: ArtifactChangeSet['command'] = 'accept',
    targetStatus: Artifact['status'] = 'accepted',
    extra: Partial<ArtifactChangeSet> = {}
  ) {
    return storage.lifecycle.propose(
      {
        requestId: randomUUID(),
        changeSet: {
          storeId: storage.storeId,
          command,
          subjectIds: subjects.map(item => item.id),
          expectedVersions: storage.catalog
            .all()
            .map(item => ({ id: item.id, version: item.metadataVersion })),
          relationChanges: [],
          targetStatuses: subjects.map(item => ({
            artifactId: item.id,
            status: targetStatus
          })),
          supplementDispositions: [],
          reason: 'Explicit lifecycle test',
          ...extra
        }
      },
      USER
    )
  }
  function pass(proposal: ReturnType<typeof propose>, readAll = true) {
    const prepared = storage.lifecycle.prepare(proposal.id, proposal.version)
    const running = storage.lifecycle.jobs.start(prepared.id, 'test')
    const sessionId = running.validatorSessionId!
    if (readAll) {
      for (const key of [
        ...prepared.manifest.requiredContentIds,
        ...prepared.manifest.threads.map(item => `review:${item.threadId}`)
      ]) {
        let offset = 0
        for (;;) {
          const chunk = storage.lifecycle.jobs.read(
            prepared.id,
            sessionId,
            key,
            offset
          )
          if (chunk.nextOffset === null) break
          offset = chunk.nextOffset
        }
      }
    }
    return {
      prepared,
      sessionId,
      submit: (
        verdict: 'pass' | 'conflict' | 'incomplete' = 'pass',
        report?: string
      ) =>
        storage.lifecycle.jobs.submit(prepared.id, sessionId, {
          verdict,
          findings: [],
          resolutions: [],
          ...(report ? { report } : {})
        })
    }
  }
  async function authorize(
    proposal: ReturnType<typeof propose>,
    validationId: string
  ) {
    const pending = await app.inject({
      method: 'POST',
      url: '/api/artifact-actions',
      payload: {
        kind: 'lifecycle',
        changeSetId: proposal.id,
        version: proposal.version,
        validationId
      }
    })
    assert.equal(pending.statusCode, 200, pending.body)
    const approved = await app.inject({
      method: 'POST',
      url: `/api/artifact-actions/${pending.json().id}/approve`,
      payload: { sourceUserRequestId: randomUUID() }
    })
    assert.equal(approved.statusCode, 200, approved.body)
    return approved.json().authorizationId as string
  }
  return {
    root,
    path,
    db,
    storage,
    app,
    create,
    propose,
    pass,
    authorize,
    registry,
    advance: (ms: number) => {
      now += ms
    },
    now: () => now
  }
}

test('lifecycle: complete coverage + pass + structured user action commits and replays exactly', async t => {
  const { storage, create, propose, pass, authorize } = await setup(t)
  const node = create()
  const proposal = propose([node])
  const validation = pass(proposal)
  assert.equal(validation.submit('pass', '# Standalone report').state, 'pass')
  const authorizationId = await authorize(proposal, validation.prepared.id)
  const input = {
    version: 1,
    validationId: validation.prepared.id,
    authorizationId,
    requestId: 'commit-1'
  }
  const result = storage.lifecycle.commit(proposal.id, input, USER)
  assert.equal(storage.get(node.id).status, 'accepted')
  assert.deepEqual(storage.lifecycle.commit(proposal.id, input, USER), result)
  assert.throws(
    () =>
      storage.lifecycle.commit(
        proposal.id,
        { ...input, requestId: 'commit-2' },
        USER
      ),
    /consumed/
  )
  assert.throws(
    () => storage.lifecycle.commit(proposal.id, { ...input, version: 2 }, USER),
    /reused/
  )
})

test('lifecycle: forged grants, missing coverage, wrong session and conflicting reports never mutate', async t => {
  const { storage, create, propose, pass, authorize } = await setup(t)
  const node = create()
  const proposal = propose([node])
  const missing = pass(proposal, false)
  assert.throws(
    () => storage.lifecycle.jobs.read(missing.prepared.id, 'foreign', node.id),
    /scope/
  )
  assert.throws(
    () =>
      storage.lifecycle.jobs.read(
        missing.prepared.id,
        missing.sessionId,
        node.id,
        8192
      ),
    /skipping/
  )
  assert.equal(missing.submit().state, 'incomplete')
  await assert.rejects(() => authorize(proposal, missing.prepared.id))
  const conflict = pass(proposal)
  assert.equal(conflict.submit('conflict').state, 'conflict')
  assert.throws(
    () =>
      storage.lifecycle.commit(
        proposal.id,
        {
          version: 1,
          validationId: conflict.prepared.id,
          authorizationId: randomUUID(),
          requestId: 'forged'
        },
        USER
      ),
    /Authorization/
  )
  assert.equal(storage.get(node.id).status, 'in_review')
})

test('lifecycle: context metadata, new blockers and physical corruption invalidate prepared results', async t => {
  for (const kind of ['metadata', 'blocker', 'file'] as const) {
    const { storage, create, propose, pass, authorize, root } = await setup(t)
    const node = create()
    const proposal = propose([node])
    const validation = pass(proposal)
    validation.submit()
    const authorizationId = await authorize(proposal, validation.prepared.id)
    if (kind === 'metadata') {
      storage.updateMetadata(
        node.id,
        {
          requestId: randomUUID(),
          expectedVersion: node.metadataVersion,
          metadata: { title: 'Changed', tags: [] }
        },
        USER
      )
    }
    if (kind === 'blocker') {
      storage.reviews.createThread(
        node.id,
        { requestId: randomUUID(), text: 'Blocking', blocking: true },
        USER
      )
    }
    if (kind === 'file') {
      appendFileSync(
        join(root, '.githuman', 'artifacts', `ght-${node.id}.md`),
        'tampered'
      )
    }
    assert.throws(() =>
      storage.lifecycle.commit(
        proposal.id,
        {
          version: 1,
          validationId: validation.prepared.id,
          authorizationId,
          requestId: randomUUID()
        },
        USER
      )
    )
    assert.equal(storage.get(node.id).status, 'in_review')
  }
})

test('lifecycle: third metadata write failure rolls back the entire package and grant consumption', async t => {
  const { storage, db, create, propose, pass, authorize } = await setup(t)
  const nodes = [create(), create(), create()]
  const proposal = propose(nodes)
  const validation = pass(proposal)
  validation.submit()
  const authorizationId = await authorize(proposal, validation.prepared.id)
  const target = [...nodes].sort((a, b) => a.id.localeCompare(b.id))[2]
  db.exec(
    `CREATE TRIGGER injected_failure BEFORE INSERT ON artifact_metadata_versions WHEN NEW.artifact_id='${target.id}' AND NEW.version=3 BEGIN SELECT RAISE(ABORT, 'third write failure'); END`
  )
  const input = {
    version: 1,
    validationId: validation.prepared.id,
    authorizationId,
    requestId: randomUUID()
  }
  const epoch = storage.catalog.epoch()
  assert.throws(
    () => storage.lifecycle.commit(proposal.id, input, USER),
    /third write/
  )
  assert.equal(storage.catalog.epoch(), epoch)
  assert.equal(storage.lifecycle.repository.consumed(authorizationId), false)
  assert.ok(nodes.every(node => storage.get(node.id).status === 'in_review'))
  db.exec('DROP TRIGGER injected_failure')
  storage.lifecycle.commit(proposal.id, input, USER)
  assert.ok(nodes.every(node => storage.get(node.id).status === 'accepted'))
})

test('lifecycle: competing prepared replacements allow only one commit', async t => {
  const { storage, create, propose, pass, authorize } = await setup(t)
  const base = create('accepted')
  const first = create('in_review', [{ kind: 'replaces', targetId: base.id }])
  const second = create('in_review', [{ kind: 'replaces', targetId: base.id }])
  const p1 = propose([first]),
    p2 = propose([second])
  const v1 = pass(p1)
  v1.submit()
  const v2 = pass(p2)
  v2.submit()
  const a1 = await authorize(p1, v1.prepared.id),
    a2 = await authorize(p2, v2.prepared.id)
  storage.lifecycle.commit(
    p1.id,
    {
      version: 1,
      validationId: v1.prepared.id,
      authorizationId: a1,
      requestId: randomUUID()
    },
    USER
  )
  assert.throws(() =>
    storage.lifecycle.commit(
      p2.id,
      {
        version: 1,
        validationId: v2.prepared.id,
        authorizationId: a2,
        requestId: randomUUID()
      },
      USER
    )
  )
  assert.equal(storage.get(base.id).status, 'superseded')
  assert.equal(storage.get(second.id).status, 'in_review')
})

test('lifecycle: leases survive a second owner, expire to incomplete, and old grants never survive restart', async t => {
  const {
    storage,
    db,
    create,
    propose,
    pass,
    registry,
    now,
    advance,
    authorize
  } = await setup(t)
  const node = create(),
    proposal = propose([node])
  const validation = pass(proposal)
  const second = new ArtifactLifecycleService(storage, db, now)
  second.attachSessions(registry)
  assert.equal(second.jobs.get(validation.prepared.id).state, 'running')
  const another = second.prepare(proposal.id, 1)
  assert.throws(() => second.jobs.start(another.id, 'test'), /active/)
  advance(10 * 60_000 + 1)
  second.jobs.recover()
  assert.equal(second.jobs.get(validation.prepared.id).state, 'incomplete')
  const fresh = pass(proposal)
  fresh.submit()
  const grant = await authorize(proposal, fresh.prepared.id)
  assert.throws(
    () =>
      second.commit(
        proposal.id,
        {
          version: 1,
          validationId: fresh.prepared.id,
          authorizationId: grant,
          requestId: randomUUID()
        },
        USER
      ),
    /Authorization/
  )
})

test('lifecycle: schema rerun and projection rebuild preserve validation history', async t => {
  const { storage, db, create, propose, pass } = await setup(t, true)
  const proposal = propose([create()]),
    validation = pass(proposal)
  validation.submit()
  const before = storage.lifecycle.repository.history(validation.prepared.id)
  applyMigrations(db)
  storage.catalog.transaction(() => storage.lifecycle.repository.rebuild())
  assert.deepEqual(
    storage.lifecycle.repository.history(validation.prepared.id),
    before
  )
  assert.equal(storage.lifecycle.jobs.get(validation.prepared.id).state, 'pass')
  assert.deepEqual(storage.lifecycle.get(proposal.id), proposal)
  assert.throws(
    () =>
      db.exec(
        'UPDATE artifact_validation_events SET payload_json=payload_json'
      ),
    /immutable/
  )
})

test('lifecycle: review grants close scoped blockers without a validation pass and cannot authorize lifecycle', async t => {
  const { storage, app, create, propose } = await setup(t)
  const base = create('accepted')
  const candidate = create('in_review', [
    { kind: 'replaces', targetId: base.id }
  ])
  const thread = storage.reviews.createThread(
    base.id,
    { requestId: randomUUID(), text: 'Inherited blocker', blocking: true },
    USER
  )
  const action = {
    kind: 'review',
    threadId: thread.threadId,
    input: {
      requestId: randomUUID(),
      kind: 'resolved',
      expectedThreadVersion: 1,
      scope: {
        appliesToArtifactId: candidate.id,
        includeRevisionDescendants: true
      }
    }
  }
  const pending = await app.inject({
    method: 'POST',
    url: '/api/artifact-actions',
    payload: action
  })
  assert.equal(pending.statusCode, 200, pending.body)
  assert.equal(pending.json().manifestDigest, null)
  const approve = await app.inject({
    method: 'POST',
    url: `/api/artifact-actions/${pending.json().id}/approve`,
    payload: { sourceUserRequestId: randomUUID() }
  })
  assert.equal(approve.statusCode, 200, approve.body)
  const grant = approve.json().authorizationId
  const proposal = propose([candidate])
  const prepared = storage.lifecycle.prepare(proposal.id, proposal.version)
  assert.throws(() =>
    storage.lifecycle.commit(
      proposal.id,
      {
        version: 1,
        validationId: prepared.id,
        authorizationId: grant,
        requestId: randomUUID()
      },
      USER
    )
  )
  const resolved = await app.inject({
    method: 'POST',
    url: '/api/artifact-review-actions',
    payload: { action, authorizationId: grant }
  })
  assert.equal(resolved.statusCode, 200, resolved.body)
  assert.equal(storage.reviews.summary(candidate.id).blockerSummary.count, 0)
  assert.equal(storage.reviews.summary(base.id).blockerSummary.count, 1)
  const replay = await app.inject({
    method: 'POST',
    url: '/api/artifact-review-actions',
    payload: { action, authorizationId: grant }
  })
  assert.deepEqual(replay.json(), resolved.json())
})

test('lifecycle: rootless replacement with transitive target blockers cannot obtain acceptance authorization', async t => {
  const { storage, app, create, propose, pass } = await setup(t)
  const original = create('superseded')
  const base = create('accepted', [], [original.id])
  const candidate = create('in_review', [
    { kind: 'replaces', targetId: base.id }
  ])
  storage.reviews.createThread(
    original.id,
    { requestId: randomUUID(), text: 'Old unresolved blocker', blocking: true },
    USER
  )
  const proposal = propose([candidate])
  const validation = pass(proposal)
  validation.submit()
  const pending = await app.inject({
    method: 'POST',
    url: '/api/artifact-actions',
    payload: {
      kind: 'lifecycle',
      changeSetId: proposal.id,
      version: 1,
      validationId: validation.prepared.id
    }
  })
  assert.equal(pending.statusCode, 409, pending.body)
  assert.equal(storage.get(candidate.id).revisionOf.length, 0)
})

test('lifecycle: expiry, explicit revocation and wrong caller invalidate grants without writes', async t => {
  for (const failure of ['expiry', 'revoke', 'caller'] as const) {
    const { storage, create, propose, pass, authorize, advance } =
      await setup(t)
    const node = create(),
      proposal = propose([node]),
      validation = pass(proposal)
    validation.submit()
    const grant = await authorize(proposal, validation.prepared.id)
    if (failure === 'expiry') advance(15 * 60_000 + 1)
    if (failure === 'revoke') storage.lifecycle.authorization.revoke(grant)
    const epoch = storage.catalog.epoch()
    assert.throws(() =>
      storage.lifecycle.commit(
        proposal.id,
        {
          version: 1,
          validationId: validation.prepared.id,
          authorizationId: grant,
          requestId: randomUUID()
        },
        failure === 'caller' ? { kind: 'agent', id: 'wrong-session' } : USER
      )
    )
    assert.equal(storage.catalog.epoch(), epoch)
    assert.equal(storage.get(node.id).status, 'in_review')
  }
})

test('lifecycle: cancellation, validator revocation and context escape cannot produce pass', async t => {
  const { storage, create, propose, pass, registry } = await setup(t)
  const node = create(),
    unrelated = create('draft'),
    proposal = propose([node])
  const cancelled = pass(proposal, false)
  assert.throws(
    () =>
      storage.lifecycle.jobs.read(
        cancelled.prepared.id,
        cancelled.sessionId,
        unrelated.id
      ),
    /outside/
  )
  assert.throws(
    () =>
      storage.lifecycle.jobs.assertOperation(
        cancelled.sessionId,
        'actions.request',
        {}
      ),
    /restricted/
  )
  storage.lifecycle.jobs.cancel(cancelled.prepared.id)
  assert.equal(
    storage.lifecycle.jobs.get(cancelled.prepared.id).state,
    'cancelled'
  )
  assert.throws(() => cancelled.submit(), /scope/)
  const revoked = pass(proposal)
  registry.close(revoked.sessionId)
  assert.throws(() => revoked.submit(), /scope/)
})

test('lifecycle: acceptance atomically applies incorporated, carry-forward and obsolete dispositions', async t => {
  const { storage, create, propose, pass, authorize } = await setup(t)
  const base = create('accepted')
  const incorporated = create('accepted', [
    { kind: 'supplements', targetId: base.id }
  ])
  const carried = create('accepted', [
    { kind: 'supplements', targetId: base.id }
  ])
  const obsolete = create('accepted', [
    { kind: 'supplements', targetId: base.id }
  ])
  const candidate = create('in_review', [
    { kind: 'replaces', targetId: base.id }
  ])
  assert.throws(() => propose([base], 'archive', 'archived'), /supplement/)
  const proposal = propose([candidate], 'accept', 'accepted', {
    supplementDispositions: [
      { artifactId: incorporated.id, disposition: 'incorporated' },
      {
        artifactId: carried.id,
        disposition: 'carry_forward',
        newBaseId: candidate.id
      },
      {
        artifactId: obsolete.id,
        disposition: 'obsolete',
        targetStatus: 'deleted'
      }
    ]
  })
  const validation = pass(proposal)
  validation.submit()
  const grant = await authorize(proposal, validation.prepared.id)
  storage.lifecycle.commit(
    proposal.id,
    {
      version: 1,
      validationId: validation.prepared.id,
      authorizationId: grant,
      requestId: randomUUID()
    },
    USER
  )
  assert.equal(storage.get(base.id).status, 'superseded')
  assert.equal(storage.get(incorporated.id).status, 'archived')
  assert.equal(storage.get(obsolete.id).status, 'deleted')
  assert.deepEqual(storage.get(carried.id).relations, [
    { kind: 'supplements', targetId: candidate.id }
  ])
  assert.equal(storage.get(carried.id).status, 'accepted')
})

test('lifecycle: another SQLite connection preserves a live owner and recovers an expired persisted job', async t => {
  const { storage, root, path, create, propose, pass, now, advance } =
    await setup(t, true)
  const proposal = propose([create()]),
    running = pass(proposal, false)
  const otherDb = createFileDatabase(path)
  t.after(() => otherDb.close())
  const other = new ArtifactStorageService({
    db: otherDb,
    repositoryPath: root,
    prefix: 'ght-',
    now
  })
  assert.equal(other.lifecycle.jobs.get(running.prepared.id).state, 'running')
  assert.deepEqual(other.lifecycle.get(proposal.id), proposal)
  advance(10 * 60_000 + 1)
  other.lifecycle.jobs.recover()
  assert.equal(
    other.lifecycle.jobs.get(running.prepared.id).state,
    'incomplete'
  )
  assert.equal(
    storage.lifecycle.jobs.get(running.prepared.id).state,
    'incomplete'
  )
})
