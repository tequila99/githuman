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
import {
  ArtifactStorageService,
  type ArtifactStorageOptions
} from '../../../src/server/services/artifact-storage.service.ts'
import { ArtifactLifecycleService } from '../../../src/server/services/artifact-lifecycle.service.ts'
import { artifactActionDigest } from '../../../src/server/services/artifact-authorization.service.ts'
import type { AgentSessionRegistry } from '../../../src/server/services/agent/session-registry.ts'
import type {
  Artifact,
  ArtifactChangeSet
} from '../../../src/shared/artifacts/types.ts'

// A fixed user identity exercises the same structured action routes as the browser.
const USER = { kind: 'user' as const, id: 'local' }

async function setup(
  t: TestContext,
  file = false,
  checkpoint?: ArtifactStorageOptions['checkpoint']
) {
  const root = mkdtempSync(join(tmpdir(), 'ght-lifecycle-'))
  const path = join(root, '.githuman/ght-reviews.db')
  const db = file ? createFileDatabase(path) : createTestDatabase()
  let now = Date.now()
  const storage = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    checkpoint,
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
      for (const key of prepared.manifest.requiredContentIds) {
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

test('report draft and validation link roll back together and retry without duplicate events', async t => {
  const { storage, create, propose, pass } = await setup(t)
  const validation = pass(propose([create('draft')]))
  const jobs = storage.lifecycle.jobs
  const repository = storage.lifecycle.repository
  const before = storage.catalog.all().length
  const history = repository.history(validation.prepared.id)
  const append = repository.appendValidation.bind(repository)
  repository.appendValidation = () => {
    throw new Error('Commit failed')
  }
  assert.throws(
    () =>
      jobs.createReport(
        validation.prepared.id,
        validation.sessionId,
        '# Report'
      ),
    /Commit failed/
  )
  assert.equal(storage.catalog.all().length, before)
  assert.deepEqual(repository.history(validation.prepared.id), history)
  repository.appendValidation = append
  const report = jobs.createReport(
    validation.prepared.id,
    validation.sessionId,
    '# Report'
  )
  assert.equal(
    repository.validation(validation.prepared.id).report?.reportArtifactId,
    report.id
  )
  const committed = repository.history(validation.prepared.id)
  assert.equal(
    jobs.createReport(validation.prepared.id, validation.sessionId, '# Report')
      .id,
    report.id
  )
  assert.deepEqual(repository.history(validation.prepared.id), committed)
  assert.throws(
    () =>
      jobs.createReport(
        validation.prepared.id,
        validation.sessionId,
        '# Changed'
      ),
    /different operation/
  )
})

test('inline report rejects invalid evidence before creation and rolls back a failed final result', async t => {
  const { storage, create, propose, pass } = await setup(t)
  const validation = pass(propose([create('draft')]))
  const jobs = storage.lifecycle.jobs
  const repository = storage.lifecycle.repository
  const before = storage.catalog.all().length
  const history = repository.history(validation.prepared.id)
  assert.throws(
    () =>
      jobs.submit(validation.prepared.id, validation.sessionId, {
        verdict: 'pass',
        findings: [
          {
            artifactId: validation.prepared.manifest.requiredContentIds[0],
            quote: 'Absent evidence',
            message: 'Problem'
          }
        ],
        resolutions: [],
        report: '# Report'
      }),
    /exact manifest text/
  )
  assert.equal(storage.catalog.all().length, before)
  const append = repository.appendValidation.bind(repository)
  repository.appendValidation = (value, kind) => {
    if (value.state === 'pass') throw new Error('Final result failed')
    append(value, kind)
  }
  assert.throws(
    () => validation.submit('pass', '# Report'),
    /Final result failed/
  )
  assert.equal(storage.catalog.all().length, before)
  assert.deepEqual(repository.history(validation.prepared.id), history)
  repository.appendValidation = append
  assert.equal(validation.submit('pass', '# Report').state, 'pass')
  const committed = repository.history(validation.prepared.id)
  assert.equal(validation.submit('pass', '# Report').state, 'pass')
  assert.deepEqual(repository.history(validation.prepared.id), committed)
  assert.throws(
    () => validation.submit('conflict', '# Report'),
    /different input/
  )
})

for (const phase of ['published', 'after_commit'] as const) {
  test(`report ${phase} interruption preserves safe recovery and replay`, async t => {
    let interrupted = false
    const { storage, create, propose, pass, advance } = await setup(
      t,
      false,
      current => {
        if (interrupted && current === phase) throw new Error('Interrupted')
      }
    )
    const validation = pass(propose([create('draft')]))
    const before = storage.catalog.all().length
    interrupted = true
    assert.throws(() => validation.submit('pass', '# Report'), /Interrupted/)
    interrupted = false
    const history = storage.lifecycle.repository.history(validation.prepared.id)
    if (phase === 'published') {
      assert.equal(storage.catalog.all().length, before)
      advance(31_000)
      const recovery = storage.recover()
      assert.equal(recovery.awaitingRetry.length, 1)
      assert.equal(storage.catalog.all().length, before)
    }
    assert.equal(validation.submit('pass', '# Report').state, 'pass')
    assert.equal(storage.catalog.all().length, before + 1)
    if (phase === 'after_commit') {
      assert.deepEqual(
        storage.lifecycle.repository.history(validation.prepared.id),
        history
      )
    }
  })
}

test('report commit rechecks a lease that expires after file publication', async t => {
  const clock: { advance?: (ms: number) => void; armed: boolean } = {
    armed: false
  }
  const { storage, create, propose, pass, advance } = await setup(
    t,
    false,
    phase => {
      if (clock.armed && phase === 'before_commit') clock.advance?.(11 * 60_000)
    }
  )
  const validation = pass(propose([create('draft')]))
  const before = storage.catalog.all().length
  const history = storage.lifecycle.repository.history(validation.prepared.id)
  clock.advance = advance
  clock.armed = true
  assert.throws(() => validation.submit('pass', '# Expired'), /expired/)
  assert.equal(storage.catalog.all().length, before)
  assert.deepEqual(
    storage.lifecycle.repository.history(validation.prepared.id),
    history
  )
})

test('standalone report can be submitted with or without the same inline body', async t => {
  const { storage, create, propose, pass } = await setup(t)
  for (const inline of [false, true]) {
    const validation = pass(propose([create('draft')]))
    const report = storage.lifecycle.jobs.createReport(
      validation.prepared.id,
      validation.sessionId,
      '# Report'
    )
    assert.equal(
      validation.submit('pass', inline ? '# Report' : undefined).report
        ?.reportArtifactId,
      report.id
    )
  }
})

test('lifecycle: complete coverage + pass + structured user action commits and replays exactly', async t => {
  const { storage, create, propose, pass, authorize } = await setup(t)
  const node = create('draft')
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

test('lifecycle: context metadata and physical corruption invalidate prepared results', async t => {
  for (const kind of ['metadata', 'file'] as const) {
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

test('0097: legacy blockers stay stored without participating in direct draft acceptance', async t => {
  const { storage, db, create, propose, pass, authorize } = await setup(t, true)
  const node = create('draft')
  const threadId = randomUUID()
  const snapshot = JSON.stringify({
    threadId,
    originArtifactId: node.id,
    version: 1,
    blocking: true,
    comments: [],
    decisions: []
  })
  db.prepare(
    'INSERT INTO artifact_review_events(store_id,thread_id,origin_artifact_id,version,request_id,data_json) VALUES(?,?,?,?,?,?)'
  ).run(storage.storeId, threadId, node.id, 1, randomUUID(), snapshot)
  db.prepare('INSERT INTO artifact_thread_current VALUES(?,?,?,?,?)').run(
    storage.storeId,
    threadId,
    node.id,
    1,
    snapshot
  )
  const original = db.prepare('SELECT * FROM artifact_review_events').all()
  applyMigrations(db)
  const proposal = propose([node])
  const validation = pass(proposal)
  assert.equal(validation.prepared.manifest.rulesVersion, 2)
  assert.equal('threads' in validation.prepared.manifest, false)
  const page = storage.lifecycle.jobs.manifest(validation.prepared.id)
  assert.ok(page.items.every(item => item.kind !== 'review'))
  assert.equal(
    page.requiredContentCount,
    validation.prepared.manifest.requiredContentIds.length
  )
  assert.throws(
    () =>
      storage.lifecycle.jobs.read(
        validation.prepared.id,
        validation.sessionId,
        `review:${threadId}`
      ),
    /outside/
  )
  validation.submit()
  const authorizationId = await authorize(proposal, validation.prepared.id)
  storage.lifecycle.commit(
    proposal.id,
    {
      version: proposal.version,
      validationId: validation.prepared.id,
      authorizationId,
      requestId: randomUUID()
    },
    USER
  )
  assert.equal(storage.get(node.id).status, 'accepted')
  assert.deepEqual(
    db.prepare('SELECT * FROM artifact_review_events').all(),
    original
  )
  assert.equal(
    db
      .prepare(
        'SELECT snapshot_json FROM artifact_thread_current WHERE thread_id=?'
      )
      .get(threadId)?.snapshot_json,
    snapshot
  )
  assert.throws(
    () => db.exec('DELETE FROM artifact_review_events'),
    /immutable/
  )
})

test('0097: v1 manifests remain readable but cannot start, authorize, approve or commit', async t => {
  const { storage, app, create, propose, pass, authorize } = await setup(t)
  const proposal = propose([create('draft')])
  const validation = pass(proposal)
  validation.submit()
  const grant = await authorize(proposal, validation.prepared.id)
  const action = {
    kind: 'lifecycle' as const,
    changeSetId: proposal.id,
    version: proposal.version,
    validationId: validation.prepared.id
  }
  const pending = storage.lifecycle.authorization.request(action, 'user:local')
  const current = storage.lifecycle.repository.validation(
    validation.prepared.id
  )
  const manifest = { ...current.manifest, rulesVersion: 1, threads: [] }
  storage.lifecycle.repository.appendValidation({
    ...current,
    manifest,
    manifestDigest: artifactActionDigest(manifest)
  })
  assert.equal(storage.lifecycle.jobs.get(current.id).state, 'pass')
  assert.ok(storage.lifecycle.jobs.history(current.id).items.length)
  assert.ok(storage.lifecycle.jobs.report(current.id).text)
  assert.throws(
    () => storage.lifecycle.jobs.manifest(current.id),
    /VALIDATION_STALE/
  )
  assert.throws(
    () => storage.lifecycle.authorization.request(action, 'user:local'),
    /VALIDATION_STALE/
  )
  const approval = await app.inject({
    method: 'POST',
    url: `/api/artifact-actions/${pending.id}/approve`,
    payload: { sourceUserRequestId: randomUUID() }
  })
  assert.equal(approval.statusCode, 409, approval.body)
  assert.throws(
    () =>
      storage.lifecycle.commit(
        proposal.id,
        {
          version: proposal.version,
          validationId: current.id,
          authorizationId: grant,
          requestId: randomUUID()
        },
        USER
      ),
    /VALIDATION_STALE/
  )
  storage.lifecycle.repository.appendValidation({
    ...current,
    manifest,
    manifestDigest: artifactActionDigest(manifest),
    state: 'prepared'
  })
  assert.throws(
    () => storage.lifecycle.jobs.start(current.id, 'test'),
    /VALIDATION_STALE/
  )
})

test('0097: stale running validators cannot create report artifacts and cleanup still releases leases', async t => {
  const { storage, create, propose, pass } = await setup(t)
  const proposal = propose([create('draft')])
  const validation = pass(proposal, false)
  const current = storage.lifecycle.repository.validation(
    validation.prepared.id
  )
  const manifest = { ...current.manifest, rulesVersion: 1, threads: [] }
  storage.lifecycle.repository.appendValidation({
    ...current,
    manifest,
    manifestDigest: artifactActionDigest(manifest)
  })
  const count = storage.catalog.all().length
  const history = storage.lifecycle.repository.history(current.id)
  assert.throws(
    () =>
      storage.lifecycle.jobs.createReport(
        current.id,
        validation.sessionId,
        '# Stale'
      ),
    /VALIDATION_STALE/
  )
  assert.throws(
    () =>
      storage.lifecycle.jobs.submit(current.id, validation.sessionId, {
        verdict: 'pass',
        findings: [],
        resolutions: [],
        report: '# Stale'
      }),
    /VALIDATION_STALE/
  )
  assert.equal(storage.catalog.all().length, count)
  assert.deepEqual(storage.lifecycle.repository.history(current.id), history)
  storage.lifecycle.jobs.cancel(current.id)
  assert.equal(storage.lifecycle.repository.lease(), undefined)
  assert.equal(storage.lifecycle.jobs.get(current.id).state, 'cancelled')
  const fresh = storage.lifecycle.prepare(proposal.id, proposal.version)
  assert.equal(storage.lifecycle.jobs.start(fresh.id, 'test').state, 'running')
})

test('0097: new review commands and grants are rejected while stored submit_review proposals remain inspectable', async t => {
  const { storage, app, create, propose } = await setup(t)
  const proposal = propose([create('draft')])
  const legacy = {
    ...proposal,
    id: randomUUID(),
    requestId: randomUUID(),
    changeSet: { ...proposal.changeSet, command: 'submit_review' as const }
  }
  storage.lifecycle.repository.appendProposal(legacy)
  const read = await app.inject(`/api/artifact-change-sets/${legacy.id}`)
  assert.equal(read.statusCode, 200, read.body)
  assert.equal(read.json().changeSet.command, 'submit_review')
  assert.ok(
    storage.lifecycle
      .preview(legacy.changeSet)
      .errors.some(error => error.code === 'unsupported_command')
  )
  assert.throws(
    () => storage.lifecycle.prepare(legacy.id, legacy.version),
    /review was removed/
  )
  const prepared = storage.lifecycle.prepare(proposal.id, proposal.version)
  storage.lifecycle.repository.appendValidation({
    ...prepared,
    changeSetId: legacy.id,
    manifest: { ...prepared.manifest, changeSet: legacy.changeSet }
  })
  const inspection = await app.inject(
    `/api/artifact-validations/${prepared.id}/check`
  )
  assert.equal(inspection.statusCode, 200, inspection.body)
  assert.equal(inspection.json().ready, false)
  assert.equal(inspection.json().preview.canonical.command, 'submit_review')
  for (const url of [
    '/api/artifact-change-sets',
    '/api/artifacts/change-sets/preview'
  ]) {
    const payload = url.endsWith('preview')
      ? legacy.changeSet
      : { requestId: randomUUID(), changeSet: legacy.changeSet }
    const response = await app.inject({ method: 'POST', url, payload })
    assert.equal(response.statusCode, 400, response.body)
  }
  const grant = await app.inject({
    method: 'POST',
    url: '/api/artifact-actions',
    payload: { kind: 'review', threadId: randomUUID(), input: {} }
  })
  assert.equal(grant.statusCode, 400, grant.body)
})
