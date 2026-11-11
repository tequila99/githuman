import { test, type TestContext } from 'node:test'
import { Value } from '@sinclair/typebox/value'
import { ArtifactValidationManifestArtifactSchema } from '../../../src/shared/artifacts/schemas.ts'
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
      onEvent: (listener: (item: { event: unknown }) => void) => () => void
      emit: (event: unknown) => void
      retired?: boolean
      prompt: () => void
    }
  >()
  const registry = {
    create(...args: unknown[]) {
      const listeners: Array<(item: { event: unknown }) => void> = []
      const value = {
        id: randomUUID(),
        status: 'ready',
        policy: args[4],
        onEvent: (listener: (item: { event: unknown }) => void) => {
          listeners.push(listener)
          return () => listeners.splice(listeners.indexOf(listener), 1)
        },
        emit: (event: unknown) => {
          for (const listener of listeners.slice()) listener({ event })
        },
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
    retire(id: string) {
      const session = sessions.get(id)
      if (session) session.retired = true
    },
    trackArtifactRequest: () => () => {},
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

test('report text and validation event roll back together and retry without duplicates', async t => {
  const { storage, create, propose, pass } = await setup(t)
  const validation = pass(propose([create('draft')]))
  const jobs = storage.lifecycle.jobs
  const repository = storage.lifecycle.repository
  const id = validation.prepared.id
  const before = storage.catalog.all().length
  const history = repository.history(id)
  const append = repository.appendValidation.bind(repository)
  repository.appendValidation = () => {
    throw new Error('Commit failed')
  }
  assert.throws(
    () => jobs.createReport(id, validation.sessionId, '# Report'),
    /Commit failed/
  )
  assert.equal(repository.reportText(id), undefined)
  assert.deepEqual(repository.history(id), history)
  repository.appendValidation = append
  const report = jobs.createReport(id, validation.sessionId, '# Report')
  assert.equal(report.bytes, Buffer.byteLength('# Report'))
  assert.equal(repository.validation(id).report?.text?.sha256, report.sha256)
  assert.equal(repository.validation(id).report?.reportArtifactId, undefined)
  assert.equal(repository.reportText(id), '# Report')
  assert.equal(storage.catalog.all().length, before)
  const committed = repository.history(id)
  assert.deepEqual(
    jobs.createReport(id, validation.sessionId, '# Report'),
    report
  )
  assert.deepEqual(repository.history(id), committed)
  assert.throws(
    () => jobs.createReport(id, validation.sessionId, '# Changed'),
    /different content/
  )
  assert.equal(repository.reportText(id), '# Report')
})

test('report text is immutable and read in UTF-8 chunks', async t => {
  const { db, storage, create, propose, pass } = await setup(t)
  const validation = pass(propose([create('draft')]))
  const jobs = storage.lifecycle.jobs
  const id = validation.prepared.id
  const text = 'Ж'.repeat(30_000)
  jobs.createReport(id, validation.sessionId, text)
  assert.throws(
    () => db.prepare('UPDATE artifact_validation_reports SET body=?').run('x'),
    /immutable/
  )
  const parts: string[] = []
  let offset: number | null = 0
  while (offset !== null) {
    const chunk = jobs.reportText(id, offset)
    assert.equal(chunk.totalBytes, Buffer.byteLength(text))
    parts.push(chunk.text)
    offset = chunk.nextOffset
  }
  assert.ok(parts.length > 1)
  assert.equal(parts.join(''), text)
  assert.throws(() => jobs.reportText(id, 1), /Invalid report offset/)
  assert.throws(
    () => jobs.createReport(id, validation.sessionId, 'a\0b'),
    /without NUL/
  )
})

test('validation without report text has none to read', async t => {
  const { storage, create, propose, pass } = await setup(t)
  const validation = pass(propose([create('draft')]))
  assert.throws(
    () => storage.lifecycle.jobs.reportText(validation.prepared.id),
    /no report text/i
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

test('expired validation stores no report text and leaves no artifact', async t => {
  const { storage, create, propose, pass, advance } = await setup(t)
  const validation = pass(propose([create('draft')]))
  const before = storage.catalog.all().length
  const history = storage.lifecycle.repository.history(validation.prepared.id)
  advance(11 * 60_000)
  assert.throws(() => validation.submit('pass', '# Expired'), /expired/)
  assert.equal(storage.catalog.all().length, before)
  assert.equal(
    storage.lifecycle.repository.reportText(validation.prepared.id),
    undefined
  )
  assert.deepEqual(
    storage.lifecycle.repository.history(validation.prepared.id),
    history
  )
})

test('report text can be submitted with or without the same inline body', async t => {
  const { storage, create, propose, pass } = await setup(t)
  for (const inline of [false, true]) {
    const validation = pass(propose([create('draft')]))
    const before = storage.catalog.all().length
    const report = storage.lifecycle.jobs.createReport(
      validation.prepared.id,
      validation.sessionId,
      '# Report'
    )
    const submitted = validation.submit('pass', inline ? '# Report' : undefined)
    assert.deepEqual(submitted.report?.text, {
      sha256: report.sha256,
      bytes: report.bytes
    })
    assert.equal(storage.catalog.all().length, before)
    assert.equal(
      JSON.stringify(
        storage.lifecycle.repository.validation(validation.prepared.id).report
      ).includes('# Report'),
      false
    )
  }
})

test('a different inline body conflicts with the stored report text', async t => {
  const { storage, create, propose, pass } = await setup(t)
  const validation = pass(propose([create('draft')]))
  storage.lifecycle.jobs.createReport(
    validation.prepared.id,
    validation.sessionId,
    '# Report'
  )
  assert.throws(() => validation.submit('pass', '# Other'), /different content/)
  assert.equal(
    storage.lifecycle.repository.reportText(validation.prepared.id),
    '# Report'
  )
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
  // The read-only change set preview is still outside the validator scope.
  assert.throws(
    () =>
      storage.lifecycle.jobs.assertOperation(
        cancelled.sessionId,
        'change_sets.preview',
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
  assert.equal(validation.prepared.manifest.rulesVersion, 4)
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

test('0116: a pending action is visible to the user list but its status only to the source session', async t => {
  const { storage, create, propose, pass, advance } = await setup(t)
  const node = create('draft')
  const proposal = propose([node])
  const validation = pass(proposal)
  validation.submit('pass', '# Standalone report')
  const pending = storage.lifecycle.authorization.request(
    {
      kind: 'lifecycle',
      changeSetId: proposal.id,
      version: proposal.version,
      validationId: validation.prepared.id
    },
    'user:local'
  )
  assert.ok(
    storage.lifecycle.authorization.list().some(item => item.id === pending.id)
  )
  assert.throws(
    () => storage.lifecycle.authorization.status(pending.id, 'agent:foreign'),
    /not found|Not found|unavailable/i
  )
  assert.equal(
    storage.lifecycle.authorization.status(pending.id, 'user:local').state,
    'pending'
  )
  // Revoking the request leaves every document as it was.
  storage.lifecycle.authorization.revoke(pending.id)
  assert.equal(storage.get(node.id).status, 'draft')
  assert.equal(storage.lifecycle.authorization.list().length, 0)
  // The source session is told that the user rejected it; another session learns nothing.
  assert.equal(
    storage.lifecycle.authorization.status(pending.id, 'user:local').state,
    'revoked'
  )
  assert.throws(
    () => storage.lifecycle.authorization.status(pending.id, 'agent:foreign'),
    /not found|Not found|unavailable/i
  )
  // A request whose time ran out is reported as expired to its source session.
  const late = storage.lifecycle.authorization.request(
    {
      kind: 'lifecycle',
      changeSetId: proposal.id,
      version: proposal.version,
      validationId: validation.prepared.id
    },
    'user:local'
  )
  advance(late.expiresAt - Date.now() + 60 * 60_000)
  assert.equal(
    storage.lifecycle.authorization.status(late.id, 'user:local').state,
    'expired'
  )
})

test('debug validation keeps the validator session open and logs the finish', async t => {
  const { storage, create, propose, registry } = await setup(t)
  const lines: string[] = []
  storage.lifecycle.jobs.setDebug(line => lines.push(line))
  const prepared = storage.lifecycle.prepare(propose([create()]).id, 1)
  const running = storage.lifecycle.jobs.start(prepared.id, 'test')
  storage.lifecycle.jobs.cancel(prepared.id)
  assert.equal(storage.lifecycle.jobs.get(prepared.id).state, 'cancelled')
  assert.equal(registry.get(running.validatorSessionId!)?.status, 'ready')
  // The kept session must give its slot to the next chat.
  assert.equal(
    (registry.get(running.validatorSessionId!) as { retired?: boolean })
      .retired,
    true
  )
  assert.ok(lines.some(line => line.endsWith('cancel')))
})

test('without debug validation the validator session closes at the end', async t => {
  const { storage, create, propose, registry } = await setup(t)
  const prepared = storage.lifecycle.prepare(propose([create()]).id, 1)
  const running = storage.lifecycle.jobs.start(prepared.id, 'test')
  storage.lifecycle.jobs.cancel(prepared.id)
  assert.equal(registry.get(running.validatorSessionId!)?.status, 'closed')
})

test('debug validation logs the reason of an incomplete finish', async t => {
  const { storage, create, propose } = await setup(t)
  const lines: string[] = []
  storage.lifecycle.jobs.setDebug(line => lines.push(line))
  const prepared = storage.lifecycle.prepare(propose([create()]).id, 1)
  storage.lifecycle.jobs.start(prepared.id, 'test')
  storage.lifecycle.jobs.close()
  assert.ok(
    lines.some(
      line =>
        line.startsWith(`[validation ${prepared.id.slice(0, 8)}] finish`) &&
        line.includes('Server stopped.')
    )
  )
})

test('lifecycle: an affected artifact outside the subjects is named in the error and found by preview', async t => {
  const { storage, create } = await setup(t)
  const plan = create('draft')
  const review = create('draft', [{ kind: 'references', targetId: plan.id }])
  // A supplements link expands the set; the subjects do not name this artifact.
  const linked = create('draft', [{ kind: 'supplements', targetId: plan.id }])
  // Accepted artifacts without tasks no longer enter every change set (ADR 0119).
  const general = create('accepted')
  const changeSet = {
    storeId: storage.storeId,
    command: 'archive' as const,
    subjectIds: [plan.id, review.id],
    expectedVersions: [plan, review].map(item => ({
      id: item.id,
      version: item.metadataVersion
    })),
    relationChanges: [],
    targetStatuses: [plan, review].map(item => ({
      artifactId: item.id,
      status: 'archived' as const
    })),
    supplementDispositions: [],
    reason: 'Archive a replaced plan and its review'
  }
  assert.throws(
    () =>
      storage.lifecycle.propose({ requestId: randomUUID(), changeSet }, USER),
    (error: Error) => {
      assert.match(
        error.message,
        new RegExp(`missing_expected_version \\[${linked.id}@v1\\]`)
      )
      return true
    }
  )
  const preview = storage.graph.previewChangeSet(changeSet)
  assert.ok(preview.affectedIds.includes(linked.id))
  assert.ok(!preview.affectedIds.includes(general.id))
  assert.deepEqual(
    preview.errors.map(item => item.code),
    ['missing_expected_version']
  )
  const proposal = storage.lifecycle.propose(
    {
      requestId: randomUUID(),
      changeSet: { ...changeSet, expectedVersions: preview.expectedVersions }
    },
    USER
  )
  assert.equal(proposal.version, 1)
})

type FakeRequester = {
  id: string
  status: string
  prompts: string[]
  emit: (status: string) => void
}

async function requesterSetup(t: Parameters<typeof setup>[0], status: string) {
  const context = await setup(t)
  const listeners: Array<(item: { event: unknown }) => void> = []
  const requester = (
    context.registry as unknown as { create: () => FakeRequester }
  ).create() as FakeRequester & {
    onEvent: (listener: (item: { event: unknown }) => void) => () => void
    prompt: (blocks: unknown, display: { text: string }) => void
  }
  requester.status = status
  requester.prompts = []
  requester.onEvent = listener => {
    listeners.push(listener)
    return () => listeners.splice(listeners.indexOf(listener), 1)
  }
  requester.prompt = (_blocks, display) => {
    requester.prompts.push(display.text)
  }
  requester.emit = next => {
    requester.status = next
    for (const listener of listeners.slice()) {
      listener({ event: { type: 'status', status: next } })
    }
  }
  const prepared = context.storage.lifecycle.prepare(
    context.propose([context.create()]).id,
    1
  )
  context.storage.lifecycle.jobs.start(
    prepared.id,
    'test',
    undefined,
    requester.id
  )
  return { ...context, requester, prepared }
}

test('a ready requester chat gets a prompt when the validation ends', async t => {
  const { storage, requester, prepared } = await requesterSetup(t, 'ready')
  storage.lifecycle.jobs.finish(prepared.id, 'incomplete', 'test')
  assert.equal(requester.prompts.length, 1)
  assert.match(requester.prompts[0], new RegExp(`${prepared.id}.*incomplete`))
})

test('a user cancel does not wake the requester chat', async t => {
  const { storage, requester, prepared } = await requesterSetup(t, 'busy')
  storage.lifecycle.jobs.cancel(prepared.id)
  requester.emit('ready')
  assert.equal(requester.prompts.length, 0)
})

test('a busy requester chat gets the prompt after its turn ends', async t => {
  const { storage, requester, prepared } = await requesterSetup(t, 'busy')
  storage.lifecycle.jobs.finish(prepared.id, 'incomplete', 'test')
  assert.equal(requester.prompts.length, 0)
  requester.emit('ready')
  assert.equal(requester.prompts.length, 1)
})

test('a requester that read the final state gets no prompt', async t => {
  const { storage, requester, prepared } = await requesterSetup(t, 'busy')
  storage.lifecycle.jobs.cancel(prepared.id)
  storage.lifecycle.jobs.observe(prepared.id, requester.id)
  requester.emit('ready')
  assert.equal(requester.prompts.length, 0)
})

test('a closed requester chat gets no prompt', async t => {
  const { storage, requester, prepared } = await requesterSetup(t, 'closed')
  storage.lifecycle.jobs.cancel(prepared.id)
  assert.equal(requester.prompts.length, 0)
})

test('no requester prompt goes out while the server stops', async t => {
  const { storage, requester } = await requesterSetup(t, 'ready')
  storage.lifecycle.jobs.close()
  assert.equal(requester.prompts.length, 0)
})

test('a stale validation tells the validator it is no user rejection and ends incomplete', async t => {
  const { storage, create, propose, registry } = await setup(t)
  const subject = create()
  const prepared = storage.lifecycle.prepare(propose([subject]).id, 1)
  const running = storage.lifecycle.jobs.start(prepared.id, 'test')
  // A metadata change of a subject needs the author: the validation becomes stale.
  storage.updateMetadata(
    subject.id,
    {
      requestId: randomUUID(),
      expectedVersion: storage.get(subject.id).metadataVersion,
      metadata: { title: 'Renamed subject', tags: ['changed'] }
    },
    USER
  )
  const session = registry.get(running.validatorSessionId!) as unknown as {
    policy: (request: unknown) => { allow: boolean; reason: string }
  }
  const decision = session.policy({
    toolCall: {
      toolCallId: 'call-1',
      name: 'mcp__githuman_artifacts__validations_manifest',
      rawInput: { id: prepared.id }
    },
    options: [{ optionId: 'allow', kind: 'allow_once', name: 'Allow' }]
  })
  assert.equal(decision.allow, false)
  assert.match(decision.reason, /stale.*not a user rejection/)
  await new Promise(resolve => setImmediate(resolve))
  const after = storage.lifecycle.jobs.get(prepared.id)
  assert.equal(after.state, 'incomplete')
  assert.match(after.reason ?? '', /stale/)
})

test('a store change outside the affected set keeps a running validation fresh', async t => {
  const { storage, create, propose } = await setup(t)
  const prepared = storage.lifecycle.prepare(propose([create()]).id, 1)
  storage.lifecycle.jobs.start(prepared.id, 'test')
  const epoch = storage.catalog.validationEpoch()
  // A general accepted document is a relevant store change outside the set (ADR 0119).
  create('accepted')
  create('draft')
  assert.ok(storage.catalog.validationEpoch() > epoch)
  assert.doesNotThrow(() =>
    storage.lifecycle.assertFresh(
      storage.lifecycle.repository.validation(prepared.id)
    )
  )
})

test('read_next packs small documents into one call and completes coverage', async t => {
  const { storage, propose } = await setup(t)
  const small = (relations: Artifact['relations'] = []) =>
    storage.create(
      {
        requestId: randomUUID(),
        body: 'Короткий текст 🧪\n'.repeat(20),
        metadata: { title: 'Small', tags: [], relations }
      },
      USER
    )
  const subject = small()
  for (let index = 0; index < 3; index++) {
    small([{ kind: 'supplements', targetId: subject.id }])
  }
  const prepared = storage.lifecycle.prepare(propose([subject]).id, 1)
  assert.equal(prepared.manifest.requiredContentIds.length, 4)
  const sessionId = storage.lifecycle.jobs.start(
    prepared.id,
    'test'
  ).validatorSessionId!
  const page = storage.lifecycle.jobs.readNext(prepared.id, sessionId)
  assert.equal(page.items.length, 4)
  assert.equal(page.remaining, 0)
  for (const item of page.items) {
    assert.equal(
      item.text,
      storage.readVerifiedFile(item.key).content.toString('utf8')
    )
  }
  assert.deepEqual(
    storage.lifecycle.jobs.readNext(prepared.id, sessionId).items,
    []
  )
  storage.lifecycle.jobs.submit(prepared.id, sessionId, {
    verdict: 'pass',
    findings: [],
    resolutions: []
  })
  assert.equal(storage.lifecycle.jobs.get(prepared.id).state, 'pass')
})

test('read_next splits a large document on UTF-8 boundaries', async t => {
  const { storage, create, propose } = await setup(t)
  const subject = create()
  const prepared = storage.lifecycle.prepare(propose([subject]).id, 1)
  const sessionId = storage.lifecycle.jobs.start(
    prepared.id,
    'test'
  ).validatorSessionId!
  const parts: Buffer[] = []
  let calls = 0
  for (;;) {
    const page = storage.lifecycle.jobs.readNext(prepared.id, sessionId)
    calls++
    for (const item of page.items) {
      assert.ok(Buffer.byteLength(item.text) <= 24 * 1024)
      parts.push(Buffer.from(item.text))
    }
    if (page.remaining === 0) break
  }
  const content = storage.readVerifiedFile(subject.id).content
  assert.equal(calls, Math.ceil(content.length / (24 * 1024)))
  assert.ok(Buffer.concat(parts).equals(content))
})

test('a stopped validator stores metrics and names the stop reason and last failure', async t => {
  const { storage, create, propose, registry, app } = await setup(t)
  const prepared = storage.lifecycle.prepare(propose([create()]).id, 1)
  const running = storage.lifecycle.jobs.start(prepared.id, 'test')
  const session = registry.get(running.validatorSessionId!) as unknown as {
    emit: (event: unknown) => void
  }
  session.emit({
    type: 'tool',
    toolCallId: 'call-1',
    title: 'mcp__githuman_artifacts__validations_read',
    status: 'pending'
  })
  session.emit({
    type: 'tool',
    toolCallId: 'call-1',
    status: 'failed',
    output: 'Read context sequentially without skipping bytes.'
  })
  session.emit({ type: 'usage', used: 1234, size: 1_000_000, cost: 0.12 })
  session.emit({ type: 'stop', stopReason: 'end_turn' })
  const view = storage.lifecycle.jobs.get(prepared.id)
  assert.equal(view.state, 'incomplete')
  assert.match(view.reason ?? '', /stop reason end_turn/)
  assert.match(view.reason ?? '', /validations_read: Read context sequentially/)
  assert.equal(view.metrics?.toolCalls, 1)
  assert.equal(view.metrics?.failedToolCalls, 1)
  assert.equal(view.metrics?.contextTokens, 1234)
  assert.equal(view.metrics?.costUsd, 0.12)
  assert.equal(view.metrics?.stopReason, 'end_turn')
  assert.ok(view.metrics.finishedAt >= view.metrics.startedAt)
  // Fastify drops fields outside the response schema; the HTTP body must keep metrics.
  const response = await app.inject({
    method: 'GET',
    url: `/api/artifact-validations/${prepared.id}`
  })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), JSON.parse(JSON.stringify(view)))
})

test('a new supplement during validation rebases it and the validator reads only the new document', async t => {
  const { storage, create, propose } = await setup(t)
  const subject = create()
  const proposal = propose([subject])
  const prepared = storage.lifecycle.prepare(proposal.id, proposal.version)
  const sessionId = storage.lifecycle.jobs.start(
    prepared.id,
    'test'
  ).validatorSessionId!
  for (;;) {
    if (
      storage.lifecycle.jobs.readNext(prepared.id, sessionId).remaining === 0
    ) {
      break
    }
  }
  const added = create('draft', [{ kind: 'supplements', targetId: subject.id }])
  const page = storage.lifecycle.jobs.readNext(prepared.id, sessionId)
  assert.equal(page.progress.totalRequired, 2)
  assert.equal(page.progress.totalBytes, subject.bytes + added.bytes)
  assert.equal(
    page.progress.readBytes,
    subject.bytes +
      page.items.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0)
  )
  assert.equal(page.progress.remainingRequired, page.remaining)
  assert.equal(page.changes?.generation, 2)
  assert.deepEqual(
    page.changes?.added.map(artifact => artifact.id),
    [added.id]
  )
  assert.deepEqual(
    page.items.map(item => item.key),
    [added.id]
  )
  const view = storage.lifecycle.jobs.get(prepared.id)
  assert.equal(view.generation, 2)
  assert.equal(view.version, proposal.version + 1)
  const next = storage.lifecycle.repository.proposal(proposal.id)
  assert.deepEqual(next.actor, { kind: 'system', id: 'validation-rebase' })
  assert.ok(next.changeSet.expectedVersions.some(item => item.id === added.id))
  for (;;) {
    if (
      storage.lifecycle.jobs.readNext(prepared.id, sessionId).remaining === 0
    ) {
      break
    }
  }
  storage.lifecycle.jobs.submit(prepared.id, sessionId, {
    verdict: 'pass',
    findings: [],
    resolutions: []
  })
  assert.equal(storage.lifecycle.jobs.get(prepared.id).state, 'pass')
})

test('submit after a rebase waits until the validator receives the changes', async t => {
  const { storage, create, propose } = await setup(t)
  const subject = create()
  const prepared = storage.lifecycle.prepare(propose([subject]).id, 1)
  const sessionId = storage.lifecycle.jobs.start(
    prepared.id,
    'test'
  ).validatorSessionId!
  for (;;) {
    if (
      storage.lifecycle.jobs.readNext(prepared.id, sessionId).remaining === 0
    ) {
      break
    }
  }
  create('draft', [{ kind: 'supplements', targetId: subject.id }])
  const report = { verdict: 'pass' as const, findings: [], resolutions: [] }
  assert.throws(
    () => storage.lifecycle.jobs.submit(prepared.id, sessionId, report),
    /manifest changed \(generation 2\).*read_next/
  )
  assert.equal(storage.lifecycle.jobs.get(prepared.id).state, 'running')
})

test('a new required supplement decision makes a running validation stale', async t => {
  const { storage, create } = await setup(t)
  const base = create('accepted')
  const subject = create('draft', [{ kind: 'replaces', targetId: base.id }])
  const preview = storage.graph.previewChangeSet({
    storeId: storage.storeId,
    command: 'accept',
    subjectIds: [subject.id],
    expectedVersions: [],
    relationChanges: [],
    targetStatuses: [
      { artifactId: subject.id, status: 'accepted' },
      { artifactId: base.id, status: 'superseded' }
    ],
    supplementDispositions: [],
    reason: 'Replace the base'
  })
  const proposal = storage.lifecycle.propose(
    {
      requestId: randomUUID(),
      changeSet: {
        storeId: storage.storeId,
        command: 'accept',
        subjectIds: [subject.id],
        expectedVersions: preview.expectedVersions,
        relationChanges: [],
        targetStatuses: [
          { artifactId: subject.id, status: 'accepted' },
          { artifactId: base.id, status: 'superseded' }
        ],
        supplementDispositions: [],
        reason: 'Replace the base'
      }
    },
    USER
  )
  const prepared = storage.lifecycle.prepare(proposal.id, proposal.version)
  const sessionId = storage.lifecycle.jobs.start(
    prepared.id,
    'test'
  ).validatorSessionId!
  // An accepted supplement of the replaced base needs an explicit disposition.
  create('accepted', [{ kind: 'supplements', targetId: base.id }])
  assert.throws(
    () => storage.lifecycle.jobs.readNext(prepared.id, sessionId),
    /VALIDATION_STALE/
  )
  assert.equal(
    storage.lifecycle.repository.proposal(proposal.id).version,
    proposal.version
  )
})

test('a validation follows its set at most five generations', async t => {
  const { storage, create, propose } = await setup(t)
  const subject = create()
  const prepared = storage.lifecycle.prepare(propose([subject]).id, 1)
  const sessionId = storage.lifecycle.jobs.start(
    prepared.id,
    'test'
  ).validatorSessionId!
  for (let generation = 2; generation <= 5; generation++) {
    create('draft', [{ kind: 'supplements', targetId: subject.id }])
    assert.equal(
      storage.lifecycle.jobs.readNext(prepared.id, sessionId).changes
        ?.generation,
      generation
    )
  }
  create('draft', [{ kind: 'supplements', targetId: subject.id }])
  assert.throws(
    () => storage.lifecycle.jobs.readNext(prepared.id, sessionId),
    /VALIDATION_STALE/
  )
})

test('a change to the subject itself makes a running validation stale, not rebased', async t => {
  const { storage, create, propose } = await setup(t)
  const subject = create()
  const proposal = propose([subject])
  const prepared = storage.lifecycle.prepare(proposal.id, proposal.version)
  const sessionId = storage.lifecycle.jobs.start(
    prepared.id,
    'test'
  ).validatorSessionId!
  storage.catalog.transaction(() =>
    storage.catalog.appendMetadata(
      { ...subject, tags: ['changed'], metadataVersion: 3 },
      randomUUID(),
      USER,
      'metadata_updated'
    )
  )
  assert.throws(
    () => storage.lifecycle.jobs.readNext(prepared.id, sessionId),
    /VALIDATION_STALE/
  )
  // The author owns decisions about subjects: the server adds no version.
  const stored = storage.lifecycle.repository.proposal(proposal.id)
  assert.equal(stored.version, proposal.version)
  assert.equal(stored.actor.kind, 'user')
  assert.equal(storage.lifecycle.jobs.get(prepared.id).generation, undefined)
})

test('a newer proposal version makes the validation of the older one stale', async t => {
  const { storage, create, propose } = await setup(t)
  const proposal = propose([create()])
  const prepared = storage.lifecycle.prepare(proposal.id, proposal.version)
  const sessionId = storage.lifecycle.jobs.start(
    prepared.id,
    'test'
  ).validatorSessionId!
  const newer = storage.lifecycle.propose(
    {
      requestId: randomUUID(),
      id: proposal.id,
      expectedVersion: proposal.version,
      changeSet: {
        ...proposal.changeSet,
        command: 'accept',
        reason: 'The author changed it'
      }
    },
    USER
  )
  assert.equal(newer.version, proposal.version + 1)
  assert.throws(
    () => storage.lifecycle.jobs.readNext(prepared.id, sessionId),
    /VALIDATION_STALE/
  )
  // No rebase version: the latest version stays the one of the author.
  const stored = storage.lifecycle.repository.proposal(proposal.id)
  assert.equal(stored.version, newer.version)
  assert.equal(stored.actor.kind, 'user')
})

// The preview refuses this command with `unsupported_command`, which no rebase can fix.
test('a validation of a historical command never rebases', async t => {
  const { storage, create, propose } = await setup(t)
  const proposal = propose([create()])
  const prepared = storage.lifecycle.prepare(proposal.id, proposal.version)
  const repository = storage.lifecycle.repository
  const read = repository.proposal.bind(repository)
  repository.proposal = id => {
    const value = read(id)
    return {
      ...value,
      changeSet: { ...value.changeSet, command: 'submit_review' }
    }
  }
  t.after(() => {
    repository.proposal = read
  })
  assert.equal(
    storage.lifecycle.rebaseInTransaction(repository.validation(prepared.id)),
    undefined
  )
})

for (const optionalRead of [false, true]) {
  test(`0111: references content is optional (read=${optionalRead}) and scoped to the manifest`, async t => {
    const { storage, create, propose, registry, app } = await setup(t)
    const outside = create('draft')
    const reference = create('draft', [
      { kind: 'references', targetId: outside.id }
    ])
    const subject = create('draft', [
      { kind: 'references', targetId: reference.id }
    ])
    const prepared = storage.lifecycle.prepare(propose([subject]).id, 1)
    assert.deepEqual(prepared.manifest.requiredContentIds, [subject.id])
    assert.deepEqual(
      prepared.manifest.artifacts.map(item => item.id).sort(),
      [subject.id, reference.id].sort()
    )
    const sessionId = storage.lifecycle.jobs.start(
      prepared.id,
      'test'
    ).validatorSessionId!
    const manifest = storage.lifecycle.jobs.manifest(prepared.id)
    assert.equal(manifest.requiredContentCount, 1)
    const response = await app.inject(
      `/api/artifact-validations/${prepared.id}/manifest`
    )
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(response.json(), manifest)
    for (const item of manifest.items) {
      if (item.kind !== 'artifact') continue
      assert.ok('contentRequired' in item)
      assert.equal(
        Value.Check(ArtifactValidationManifestArtifactSchema, item),
        true
      )
      assert.equal(item.contentRequired, item.id === subject.id)
    }
    const session = registry.get(sessionId) as unknown as {
      policy: (request: unknown) => { allow: boolean; reason: string }
    }
    for (const operation of ['validations_read', 'artifacts_get_content']) {
      for (const [key, allowed] of [
        [reference.id, true],
        [outside.id, false]
      ] as const) {
        const decision = session.policy({
          toolCall: {
            toolCallId: randomUUID(),
            name: `mcp__githuman_artifacts__${operation}`,
            rawInput:
              operation === 'validations_read'
                ? { id: prepared.id, key }
                : { id: key }
          },
          options: [{ optionId: 'allow', kind: 'allow_once', name: 'Allow' }]
        })
        assert.equal(decision.allow, allowed, decision.reason)
      }
    }
    assert.throws(
      () => storage.lifecycle.jobs.read(prepared.id, sessionId, outside.id),
      /outside/
    )
    if (optionalRead) {
      const chunk = storage.lifecycle.jobs.contentForSession(
        sessionId,
        reference.id
      )
      assert.equal(chunk.id, reference.id)
      assert.ok(chunk.text.length > 0)
    }
    const readIds = new Set<string>()
    for (;;) {
      const page = storage.lifecycle.jobs.readNext(prepared.id, sessionId)
      for (const item of page.items) readIds.add(item.key)
      if (!page.remaining) break
    }
    assert.deepEqual([...readIds], [subject.id])
    storage.lifecycle.jobs.submit(prepared.id, sessionId, {
      verdict: 'pass',
      findings: [],
      resolutions: []
    })
    const result = storage.lifecycle.repository.validation(prepared.id)
    assert.equal(result.state, 'pass')
    assert.deepEqual(
      result.readCoverage?.map(item => item.key),
      [subject.id]
    )
  })
}

test('0111: missing required content stays incomplete even when optional content was read', async t => {
  const { storage, create, propose } = await setup(t)
  const reference = create('draft')
  const subject = create('draft', [
    { kind: 'references', targetId: reference.id }
  ])
  const prepared = storage.lifecycle.prepare(propose([subject]).id, 1)
  const sessionId = storage.lifecycle.jobs.start(
    prepared.id,
    'test'
  ).validatorSessionId!
  let offset = 0
  for (;;) {
    const chunk = storage.lifecycle.jobs.read(
      prepared.id,
      sessionId,
      reference.id,
      offset
    )
    if (chunk.nextOffset === null) break
    offset = chunk.nextOffset
  }
  storage.lifecycle.jobs.submit(prepared.id, sessionId, {
    verdict: 'pass',
    findings: [],
    resolutions: []
  })
  assert.equal(storage.lifecycle.jobs.get(prepared.id).state, 'incomplete')
})

test('0111: optional manifest content can supply exact finding evidence', async t => {
  const { storage, create, propose, pass } = await setup(t)
  const reference = create('draft')
  const subject = create('draft', [
    { kind: 'references', targetId: reference.id }
  ])
  const validation = pass(propose([subject]))
  storage.lifecycle.jobs.read(
    validation.prepared.id,
    validation.sessionId,
    reference.id
  )
  storage.lifecycle.jobs.submit(validation.prepared.id, validation.sessionId, {
    verdict: 'conflict',
    findings: [
      {
        artifactId: reference.id,
        quote: 'Обязательный текст',
        message: 'Conflicting context'
      }
    ],
    resolutions: []
  })
  assert.equal(
    storage.lifecycle.jobs.get(validation.prepared.id).state,
    'conflict'
  )
})

test('0111: optional manifest content that was not read cannot supply finding evidence', async t => {
  const { storage, create, propose, pass } = await setup(t)
  const reference = create('draft')
  const subject = create('draft', [
    { kind: 'references', targetId: reference.id }
  ])
  const validation = pass(propose([subject]))
  assert.throws(
    () =>
      storage.lifecycle.jobs.submit(
        validation.prepared.id,
        validation.sessionId,
        {
          verdict: 'conflict',
          findings: [
            {
              artifactId: reference.id,
              quote: 'Обязательный текст',
              message: 'Conflicting context'
            }
          ],
          resolutions: []
        }
      ),
    /exact manifest text/
  )
})

test('0111: optional metadata changes remain version checked without requiring body reads', async t => {
  const { storage, create, propose } = await setup(t)
  const reference = create('draft')
  const subject = create('draft', [
    { kind: 'references', targetId: reference.id }
  ])
  const prepared = storage.lifecycle.prepare(propose([subject]).id, 1)
  const sessionId = storage.lifecycle.jobs.start(
    prepared.id,
    'test'
  ).validatorSessionId!
  storage.updateMetadata(
    reference.id,
    {
      requestId: randomUUID(),
      expectedVersion: reference.metadataVersion,
      metadata: { title: 'Updated reference', tags: [] }
    },
    USER
  )
  assert.throws(
    () => storage.lifecycle.assertFresh(prepared),
    /VALIDATION_STALE/
  )
  const page = storage.lifecycle.jobs.readNext(prepared.id, sessionId)
  assert.equal(page.changes?.changed[0].id, reference.id)
  assert.equal(page.changes?.changed[0].contentRequired, false)
  assert.ok(page.items.every(item => item.key === subject.id))
})

test('0111: an optional target promoted by a new structural path is delivered as required', async t => {
  const { storage, create, propose } = await setup(t)
  const target = create('draft')
  const subject = create('draft', [{ kind: 'references', targetId: target.id }])
  const prepared = storage.lifecycle.prepare(propose([subject]).id, 1)
  const sessionId = storage.lifecycle.jobs.start(
    prepared.id,
    'test'
  ).validatorSessionId!
  while (storage.lifecycle.jobs.readNext(prepared.id, sessionId).remaining) {}
  const bridge = create('draft', [
    { kind: 'parent', targetId: subject.id },
    { kind: 'parent', targetId: target.id }
  ])
  const page = storage.lifecycle.jobs.readNext(prepared.id, sessionId)
  assert.equal(
    page.changes?.changed.find(item => item.id === target.id)?.contentRequired,
    true
  )
  assert.equal(
    page.changes?.added.find(item => item.id === bridge.id)?.contentRequired,
    true
  )
  const readIds = new Set(page.items.map(item => item.key))
  while (true) {
    const next = storage.lifecycle.jobs.readNext(prepared.id, sessionId)
    for (const item of next.items) readIds.add(item.key)
    if (!next.remaining) break
  }
  assert.deepEqual([...readIds].sort(), [target.id, bridge.id].sort())
  storage.lifecycle.jobs.submit(prepared.id, sessionId, {
    verdict: 'pass',
    findings: [],
    resolutions: []
  })
  assert.equal(storage.lifecycle.jobs.get(prepared.id).state, 'pass')
})

test('0111: physical corruption of optional context still invalidates the manifest', async t => {
  const { storage, create, propose, root } = await setup(t)
  const reference = create('draft')
  const subject = create('draft', [
    { kind: 'references', targetId: reference.id }
  ])
  const prepared = storage.lifecycle.prepare(propose([subject]).id, 1)
  appendFileSync(
    join(root, '.githuman', 'artifacts', `ght-${reference.id}.md`),
    '\ncorrupt'
  )
  assert.throws(() => storage.lifecycle.assertFresh(prepared), {
    code: 'GHT_ARTIFACT_INTEGRITY'
  })
})

test('0113: required progress ignores optional reads and rereads, survives another service, and reaches HTTP', async t => {
  const { storage, create, propose, app, db } = await setup(t)
  const optional = create('draft')
  const subject = create('draft', [
    { kind: 'references', targetId: optional.id }
  ])
  const prepared = storage.lifecycle.prepare(propose([subject]).id, 1)
  const jobs = storage.lifecycle.jobs
  const sessionId = jobs.start(prepared.id, 'test').validatorSessionId!
  const expected = {
    readBytes: 0,
    totalBytes: subject.bytes,
    readRequired: 0,
    totalRequired: 1,
    remainingRequired: 1
  }
  assert.deepEqual(jobs.get(prepared.id).progress, expected)
  const epoch = storage.catalog.validationEpoch()
  const storeEpoch = storage.catalog.epoch()
  assert.deepEqual(
    jobs.read(prepared.id, sessionId, optional.id).progress,
    expected
  )
  const first = jobs.read(prepared.id, sessionId, subject.id)
  assert.equal(first.progress.readBytes, Buffer.byteLength(first.text))
  assert.equal(first.progress.remainingRequired, 1)
  assert.deepEqual(
    jobs.read(prepared.id, sessionId, subject.id).progress,
    first.progress
  )
  assert.equal(storage.catalog.validationEpoch(), epoch)
  assert.ok(storage.catalog.epoch() > storeEpoch)
  assert.deepEqual(
    new ArtifactLifecycleService(storage, db).jobs.get(prepared.id).progress,
    first.progress
  )
  const response = await app.inject({
    method: 'GET',
    url: `/api/artifact-validations/${prepared.id}`
  })
  assert.equal(response.statusCode, 200, response.body)
  assert.deepEqual(response.json().progress, first.progress)
  const manifest = jobs.manifest(prepared.id)
  const entry = manifest.items.find(item => item.id === subject.id)
  assert.ok(entry && 'pages' in entry)
  assert.equal(entry.chunkBytes, 24 * 1024)
  assert.equal(entry.pages, Math.ceil(subject.bytes / (24 * 1024)))
  while (jobs.readNext(prepared.id, sessionId).remaining) {}
  const complete = {
    ...expected,
    readBytes: subject.bytes,
    readRequired: 1,
    remainingRequired: 0
  }
  assert.deepEqual(jobs.get(prepared.id).progress, complete)
  const historySize = jobs.history(prepared.id, 0, 100).items.length
  jobs.readNext(prepared.id, sessionId)
  jobs.read(prepared.id, sessionId, subject.id)
  assert.equal(jobs.history(prepared.id, 0, 100).items.length, historySize)
  jobs.submit(prepared.id, sessionId, {
    verdict: 'pass',
    findings: [],
    resolutions: []
  })
  assert.deepEqual(jobs.get(prepared.id).progress, complete)
})

test('0113: no required documents means zero progress', async t => {
  const { storage, create, propose } = await setup(t)
  const subject = create()
  const prepared = storage.lifecycle.prepare(propose([subject]).id, 1)
  const value = storage.lifecycle.repository.validation(prepared.id)
  storage.lifecycle.repository.appendValidation({
    ...value,
    manifest: { ...value.manifest, requiredContentIds: [] }
  })
  assert.deepEqual(storage.lifecycle.jobs.get(prepared.id).progress, {
    readBytes: 0,
    totalBytes: 0,
    readRequired: 0,
    totalRequired: 0,
    remainingRequired: 0
  })
})

for (const mode of ['read', 'read_next'] as const) {
  test(`0113: ${mode} does not skip undelivered content after a progress write failure`, async t => {
    const { storage, create, propose } = await setup(t)
    const subject = create()
    const jobs = storage.lifecycle.jobs
    const prepared = storage.lifecycle.prepare(propose([subject]).id, 1)
    const sessionId = jobs.start(prepared.id, 'test').validatorSessionId!
    const epoch = storage.catalog.epoch()
    const original = storage.catalog.recordChange.bind(storage.catalog)
    t.mock.method(storage.catalog, 'recordChange', () => {
      throw new Error('progress write failed')
    })
    const read = () =>
      mode === 'read'
        ? jobs.read(prepared.id, sessionId, subject.id)
        : jobs.readNext(prepared.id, sessionId).items[0]
    assert.throws(read, /progress write failed/)
    assert.equal(jobs.get(prepared.id).progress.readBytes, 0)
    assert.equal(
      storage.lifecycle.repository.validation(prepared.id).progress,
      undefined
    )
    assert.equal(storage.catalog.epoch(), epoch)
    t.mock.method(storage.catalog, 'recordChange', original)
    const retry = read()
    assert.equal(retry.offset, 0)
    assert.equal(
      retry.text,
      storage
        .readVerifiedFile(subject.id)
        .content.subarray(0, Buffer.byteLength(retry.text))
        .toString('utf8')
    )
  })
}

test('0113: cancellation between content read and progress write is never overwritten', async t => {
  const { storage, create, propose, db } = await setup(t)
  const subject = create()
  const jobs = storage.lifecycle.jobs
  const prepared = storage.lifecycle.prepare(propose([subject]).id, 1)
  const sessionId = jobs.start(prepared.id, 'test').validatorSessionId!
  const other = new ArtifactLifecycleService(storage, db)
  const original = storage.readVerifiedFile.bind(storage)
  let cancelled = false
  t.mock.method(storage, 'readVerifiedFile', (id: string) => {
    const result = original(id)
    if (!cancelled) {
      cancelled = true
      other.jobs.cancel(prepared.id)
    }
    return result
  })
  assert.throws(() => jobs.readNext(prepared.id, sessionId), /unavailable/)
  assert.equal(jobs.get(prepared.id).state, 'cancelled')
  assert.equal(jobs.get(prepared.id).progress.readBytes, 0)
})

test('0113: a failed batch after rebase keeps new content and manifest changes pending', async t => {
  const { storage, create, propose } = await setup(t)
  const subject = create()
  const jobs = storage.lifecycle.jobs
  const prepared = storage.lifecycle.prepare(propose([subject]).id, 1)
  const sessionId = jobs.start(prepared.id, 'test').validatorSessionId!
  while (jobs.readNext(prepared.id, sessionId).remaining) {}
  const added = create('draft', [{ kind: 'supplements', targetId: subject.id }])
  const append = storage.lifecycle.repository.appendValidation.bind(
    storage.lifecycle.repository
  )
  t.mock.method(
    storage.lifecycle.repository,
    'appendValidation',
    (value: Parameters<typeof append>[0], kind?: string) => {
      if (kind === 'progress' && value.progress!.readBytes > subject.bytes) {
        throw new Error('batch progress failed')
      }
      append(value, kind)
    }
  )
  assert.throws(
    () => jobs.readNext(prepared.id, sessionId),
    /batch progress failed/
  )
  assert.equal(jobs.get(prepared.id).progress.readBytes, subject.bytes)
  t.mock.method(storage.lifecycle.repository, 'appendValidation', append)
  const retry = jobs.readNext(prepared.id, sessionId)
  assert.equal(retry.items[0].key, added.id)
  assert.equal(retry.items[0].offset, 0)
  assert.ok(retry.changes?.added.some(item => item.id === added.id))
})
