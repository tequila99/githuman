import { fork } from 'node:child_process'
import { once } from 'node:events'
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import {
  createFileDatabase,
  createTestDatabase
} from '../../../src/server/db/index.ts'
import { applyMigrations } from '../../../src/server/db/migrations.ts'
import {
  ArtifactStorageService,
  type ArtifactCheckpoint
} from '../../../src/server/services/artifact-storage.service.ts'
import {
  ArtifactConflictError,
  ArtifactIntegrityError,
  ArtifactTooLargeError
} from '../../../src/server/errors/artifacts.ts'
import { createEventBus } from '../../../src/server/event-bus.ts'
import { MAX_ARTIFACT_BODY_BYTES } from '../../../src/shared/artifacts/constants.ts'
import type { ArtifactActor } from '../../../src/shared/artifacts/types.ts'

// Use stable identities to distinguish retries from different actors.
const ACTOR: ArtifactActor = { kind: 'agent', id: 'test-agent' }
// Same identity with a different property order, as after JSON round trips.
const SWAPPED_ACTOR = { id: ACTOR.id, kind: ACTOR.kind }
// Exercise byte offsets and line preservation with multibyte text.
const BODY = '# План 🧪\r\n\r\nПервая строка\nВторая строка\r\n'

function setup(t: TestContext, prefix = 'ght-') {
  const root = mkdtempSync(join(tmpdir(), 'ght-artifacts-'))
  const db = createTestDatabase()
  const eventBus = createEventBus()
  const service = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix,
    eventBus
  })
  t.after(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { root, db, service, eventBus }
}
function input(requestId = 'create-1') {
  return {
    requestId,
    body: BODY,
    metadata: { title: 'План', tags: ['backend', 'план'] }
  }
}

test('immutable bytes, metadata history, idempotency and post-commit events', t => {
  const { root, db, service, eventBus } = setup(t)
  const epochs: number[] = []
  eventBus.subscribe(event => {
    assert.equal(service.list().storeEpoch, event.storeEpoch)
    epochs.push(event.storeEpoch!)
  })
  const first = service.create(input(), ACTOR)
  const path = join(root, '.githuman/artifacts', `ght-${first.id}.md`)
  const bytes = readFileSync(path)
  const [header, body] = bytes.toString('utf8').slice(4).split('---\n')
  assert.equal(body, BODY)
  assert.equal(parse(header).artifact_id, first.id)
  assert.equal(parse(header).status, 'draft')
  assert.equal(parse(header).title, 'План')
  assert.equal(service.readContent(first.id).text, bytes.toString('utf8'))
  assert.equal(
    bytes
      .toString('utf8')
      .split('\n')
      .slice(first.bodyStartLine - 1)
      .join('\n'),
    BODY
  )
  assert.deepEqual(service.create(input(), ACTOR), first)
  assert.equal(epochs.length, 1)
  assert.throws(
    () => service.create({ ...input(), body: 'different' }, ACTOR),
    ArtifactConflictError
  )
  assert.throws(
    () => service.create(input(), { kind: 'agent', id: 'other' }),
    ArtifactConflictError
  )
  const update = {
    requestId: 'edit-1',
    expectedVersion: 1,
    metadata: { title: 'Новый план', tags: ['review'] }
  }
  const second = service.updateMetadata(first.id, update, ACTOR)
  assert.equal(second.metadataVersion, 2)
  assert.deepEqual(readFileSync(path), bytes)
  assert.deepEqual(service.updateMetadata(first.id, update, ACTOR), second)
  assert.throws(
    () =>
      service.updateMetadata(
        first.id,
        { ...update, requestId: 'edit-stale' },
        ACTOR
      ),
    ArtifactConflictError
  )
  const history = service.history(first.id).items
  assert.deepEqual(
    history.map(event => event.metadata.title),
    ['План', 'Новый план']
  )
  assert.deepEqual(
    history.map(event => event.beforeVersion),
    [null, 1]
  )
  assert.deepEqual(
    history.map(event => event.afterVersion),
    [1, 2]
  )
  assert.equal(epochs.length, 2)
  assert.equal(service.catalog.epoch(), history[1].seq)
  for (const table of [
    'artifact_stores',
    'artifacts',
    'artifact_metadata_versions',
    'artifact_events',
    'artifact_operations',
    'artifact_operation_events'
  ]) {
    assert.throws(() => db.exec(`DELETE FROM ${table}`), /immutable/)
    const column = table === 'artifact_stores' ? 'id' : 'store_id'
    assert.throws(
      () => db.exec(`UPDATE ${table} SET ${column}=${column}`),
      /immutable/
    )
  }
  db.exec('DELETE FROM artifact_current; DELETE FROM artifact_store_epochs')
  service.catalog.rebuild()
  assert.deepEqual(service.get(first.id), second)
  assert.equal(service.catalog.epoch(), history[1].seq)
})

for (const phase of [
  'reserved',
  'temp_synced',
  'published',
  'before_commit',
  'after_commit'
] as ArtifactCheckpoint[]) {
  test(`recover a crash at ${phase} without duplicate publication`, t => {
    const { root, db, service } = setup(t)
    let now = Date.now()
    const crashed = new ArtifactStorageService({
      db,
      repositoryPath: root,
      prefix: 'ght-',
      now: () => now,
      checkpoint: current => {
        if (phase === current) throw new Error('simulated process stop')
      }
    })
    assert.throws(
      () => crashed.create(input(), ACTOR),
      /simulated process stop/
    )
    const operation = service.catalog.operation('create-1')!
    const restarted = new ArtifactStorageService({
      db,
      repositoryPath: root,
      prefix: 'ght-',
      now: () => now
    })
    if (phase !== 'after_commit') {
      assert.equal(restarted.list().items.length, 0)
      assert.deepEqual(restarted.recover().busy, [operation.artifactId])
    }
    now += 31_000
    const recovery = restarted.recover()
    if (phase === 'reserved') {
      assert.deepEqual(recovery.awaitingRetry, [operation.artifactId])
      assert.equal(restarted.list().items.length, 0)
    } else {
      assert.equal(restarted.list().items.length, 1)
    }
    const result = restarted.create(input(), ACTOR)
    assert.equal(result.id, operation.artifactId)
    assert.equal(result.sha256, operation.data.artifact.sha256)
    assert.equal(restarted.history(result.id).items.length, 1)
    assert.deepEqual(readdirSync(join(root, '.githuman/artifacts')), [
      `ght-${result.id}.md`
    ])
    assert.equal(restarted.readContent(result.id).text.endsWith(BODY), true)
  })
}

test('incomplete temporary file waits for the same request and is never published', t => {
  const { root, db, service } = setup(t)
  let now = Date.now()
  const crashed = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    now: () => now,
    checkpoint: phase => {
      if (phase === 'temp_synced') throw new Error('crash')
    }
  })
  assert.throws(() => crashed.create(input(), ACTOR), /crash/)
  const op = service.catalog.operation('create-1')!
  writeFileSync(join(root, '.githuman/artifacts', op.data.tempName), 'partial')
  now += 31_000
  const restarted = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    now: () => now
  })
  assert.deepEqual(restarted.recover().awaitingRetry, [op.artifactId])
  assert.equal(restarted.list().items.length, 0)
  assert.equal(restarted.create(input(), ACTOR).id, op.artifactId)
})

test('existing conflicting final file is never overwritten or imported', t => {
  const { root, db, service } = setup(t)
  let now = Date.now()
  const crashed = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    now: () => now,
    checkpoint: phase => {
      if (phase === 'reserved') throw new Error('crash')
    }
  })
  assert.throws(() => crashed.create(input(), ACTOR), /crash/)
  const op = service.catalog.operation('create-1')!
  mkdirSync(join(root, '.githuman/artifacts'), { recursive: true })
  const path = join(root, '.githuman/artifacts', op.data.fileName)
  writeFileSync(path, 'foreign content')
  now += 31_000
  const restarted = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    now: () => now
  })
  assert.deepEqual(restarted.recover().failed, [op.artifactId])
  assert.equal(restarted.list().items.length, 0)
  assert.equal(readFileSync(path, 'utf8'), 'foreign content')
  assert.throws(() => restarted.create(input(), ACTOR), ArtifactIntegrityError)
  writeFileSync(join(root, '.githuman/artifacts', 'ght-orphan.md'), 'orphan')
  assert.deepEqual(restarted.diagnostics().orphanFiles, ['ght-orphan.md'])
})

test('missing and modified committed files fail instead of returning empty content', t => {
  const { root, service } = setup(t)
  const artifact = service.create(input(), ACTOR)
  const path = join(root, '.githuman/artifacts', `ght-${artifact.id}.md`)
  writeFileSync(path, 'changed')
  assert.throws(() => service.readContent(artifact.id), ArtifactIntegrityError)
  assert.throws(() => service.create(input(), ACTOR), ArtifactIntegrityError)
  rmSync(path)
  assert.throws(() => service.readContent(artifact.id), ArtifactIntegrityError)
})

for (const prefix of ['ght-', 'custom-', '']) {
  test(`namespace ${JSON.stringify(prefix)} has stable store identity and correct filenames`, t => {
    const { root, db, service } = setup(t, prefix)
    const artifact = service.create(input(), ACTOR)
    const reopened = new ArtifactStorageService({
      db,
      repositoryPath: root,
      prefix
    })
    assert.equal(reopened.storeId, service.storeId)
    assert.equal(reopened.get(artifact.id).id, artifact.id)
    assert.deepEqual(readdirSync(join(root, '.githuman/artifacts')), [
      `${prefix}${artifact.id}.md`
    ])
    const other = new ArtifactStorageService({
      db,
      repositoryPath: root,
      prefix: `${prefix}other-`
    })
    assert.notEqual(other.storeId, service.storeId)
    assert.equal(other.list().items.length, 0)
  })
}

test('catalog and history pagination and UTF-8 chunk boundaries', t => {
  const { service } = setup(t)
  const artifacts = [
    service.create(input('a'), ACTOR),
    service.create(input('b'), ACTOR),
    service.create(input('c'), ACTOR)
  ]
  const first = service.list(1)
  const second = service.list(1, first.nextCursor!)
  const third = service.list(1, second.nextCursor!)
  assert.equal(third.nextCursor, null)
  assert.equal(
    new Set(
      [...first.items, ...second.items, ...third.items].map(item => item.id)
    ).size,
    3
  )
  const id = artifacts[0].id
  const original = service.readContent(id).text
  let offset = 0
  let text = ''
  for (;;) {
    const chunk = service.readContent(id, offset, 7)
    assert.ok(Buffer.byteLength(chunk.text) <= 7)
    text += chunk.text
    if (chunk.nextOffset === null) break
    assert.ok(chunk.nextOffset > offset)
    offset = chunk.nextOffset
  }
  assert.equal(text, original)
  const emoji = Buffer.from(original).indexOf(Buffer.from('🧪'))
  assert.throws(() => service.readContent(id, emoji + 1), /UTF-8 boundary/)
  assert.throws(() => service.readContent(id, -1), /range/)
  assert.throws(() => service.list(101), /page size/)
  assert.throws(() => service.list(1, 'garbage'), /cursor/)
  service.updateMetadata(
    id,
    {
      requestId: 'edit',
      expectedVersion: 1,
      metadata: { title: 'Edited', tags: [] }
    },
    ACTOR
  )
  assert.throws(() => service.list(1, first.nextCursor!), ArtifactConflictError)
  const history1 = service.history(id, 0, 1)
  const history2 = service.history(id, history1.nextAfterSeq!, 1)
  assert.equal(history1.items[0].action, 'created')
  assert.equal(history2.items[0].action, 'metadata_updated')
  assert.equal(history2.nextAfterSeq, null)
})

test('input validation and size limits happen before reserving an operation', t => {
  const { service } = setup(t)
  assert.throws(
    () =>
      service.create(
        { ...input(), body: 'a'.repeat(MAX_ARTIFACT_BODY_BYTES + 1) },
        ACTOR
      ),
    ArtifactTooLargeError
  )
  assert.throws(
    () => service.create({ ...input(), body: '\ud800' }, ACTOR),
    /UTF-8/
  )
  assert.throws(
    () => service.create({ ...input(), body: '\0' }, ACTOR),
    /UTF-8/
  )
  assert.throws(
    () =>
      service.create({ ...input(), metadata: { title: ' ', tags: [] } }, ACTOR),
    /metadata/
  )
  assert.equal(service.catalog.operations().length, 0)
  const large = service.create(
    { ...input(), body: 'a'.repeat(MAX_ARTIFACT_BODY_BYTES) },
    ACTOR
  )
  assert.ok(large.bytes <= 2 * 1024 * 1024)
})

test('symlink storage directories and files are rejected', t => {
  const { root, db, service } = setup(t)
  const outside = mkdtempSync(join(tmpdir(), 'ght-outside-'))
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  mkdirSync(join(root, '.githuman'))
  symlinkSync(outside, join(root, '.githuman/artifacts'), 'dir')
  assert.throws(() => service.create(input(), ACTOR), ArtifactIntegrityError)
  assert.deepEqual(readdirSync(outside), [])
  unlinkSync(join(root, '.githuman/artifacts'))
  const clean = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'safe-'
  })
  const artifact = clean.create(input('safe'), ACTOR)
  const path = join(root, '.githuman/artifacts', `safe-${artifact.id}.md`)
  rmSync(path)
  const target = join(outside, 'target.md')
  writeFileSync(target, 'secret')
  symlinkSync(target, path)
  assert.throws(() => clean.readContent(artifact.id), ArtifactIntegrityError)
  assert.equal(readFileSync(target, 'utf8'), 'secret')
  assert.throws(
    () =>
      new ArtifactStorageService({ db, repositoryPath: root, prefix: '../' }),
    /prefix/
  )
})

test('two database connections serialize updates, migrations are repeatable and restore preserves identity', t => {
  const root = mkdtempSync(join(tmpdir(), 'ght-durable-'))
  const path = join(root, 'data.db')
  const db1 = createFileDatabase(path)
  const db2 = createFileDatabase(path)
  t.after(() => {
    db2.close()
    db1.close()
    rmSync(root, { recursive: true, force: true })
  })
  const a = new ArtifactStorageService({
    db: db1,
    repositoryPath: root,
    prefix: 'ght-'
  })
  const b = new ArtifactStorageService({
    db: db2,
    repositoryPath: root,
    prefix: 'ght-'
  })
  const first = a.create(input(), ACTOR)
  assert.deepEqual(b.create(input(), ACTOR), first)
  const metadata = { title: 'Updated', tags: [] }
  a.updateMetadata(
    first.id,
    { requestId: 'update-a', expectedVersion: 1, metadata },
    ACTOR
  )
  assert.throws(
    () =>
      b.updateMetadata(
        first.id,
        { requestId: 'update-b', expectedVersion: 1, metadata },
        ACTOR
      ),
    ArtifactConflictError
  )
  assert.equal(b.history(first.id).items.length, 2)
  const tablesBefore = db1
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
  applyMigrations(db1)
  assert.deepEqual(
    db1
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all(),
    tablesBefore
  )
  b.catalog.rebuild()
  assert.deepEqual(a.get(first.id), b.get(first.id))
})

test('metadata transaction rollback preserves both projections and authoritative history', t => {
  const { db, service } = setup(t)
  const first = service.create(input(), ACTOR)
  db.exec(
    `CREATE TRIGGER fail_artifact_event BEFORE INSERT ON artifact_events BEGIN SELECT RAISE(ABORT,'simulated DB failure'); END`
  )
  assert.throws(
    () =>
      service.updateMetadata(
        first.id,
        {
          requestId: 'edit',
          expectedVersion: 1,
          metadata: { title: 'changed', tags: [] }
        },
        ACTOR
      ),
    /simulated DB failure/
  )
  assert.deepEqual(service.get(first.id), first)
  assert.equal(service.history(first.id).items.length, 1)
  assert.equal(service.catalog.operation('edit'), undefined)
  db.exec('DROP TRIGGER fail_artifact_event')
  assert.equal(
    service.updateMetadata(
      first.id,
      {
        requestId: 'edit',
        expectedVersion: 1,
        metadata: { title: 'changed', tags: [] }
      },
      ACTOR
    ).metadataVersion,
    2
  )
})

test('publication survives a rolled-back database commit and recovers exactly once', t => {
  const { root, db, service } = setup(t)
  let now = Date.now()
  const writer = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    now: () => now
  })
  db.exec(
    `CREATE TRIGGER fail_artifact_event BEFORE INSERT ON artifact_events BEGIN SELECT RAISE(ABORT,'simulated DB failure'); END`
  )
  assert.throws(() => writer.create(input(), ACTOR), /simulated DB failure/)
  assert.equal(writer.list().items.length, 0)
  const op = writer.catalog.operation('create-1')!
  assert.equal(op.state, 'pending')
  assert.equal(
    readFileSync(join(root, '.githuman/artifacts', op.data.fileName)).length,
    op.data.artifact.bytes
  )
  db.exec('DROP TRIGGER fail_artifact_event')
  now += 31_000
  const restarted = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    now: () => now
  })
  assert.deepEqual(restarted.recover().recovered, [op.artifactId])
  assert.equal(service.history(op.artifactId).items.length, 1)
})

test('epoch polling observes another writer and emits no duplicate invalidations', t => {
  const { root, db, service, eventBus } = setup(t)
  const other = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  const events: number[] = []
  eventBus.subscribe(event => events.push(event.storeEpoch!))
  other.create(input(), ACTOR)
  service.pollChanges()
  service.pollChanges()
  assert.deepEqual(events, [service.catalog.epoch()])
})

test('stopped backup restored in another root keeps store identity, bytes and history', t => {
  const root = mkdtempSync(join(tmpdir(), 'ght-backup-'))
  const restoredRoot = mkdtempSync(join(tmpdir(), 'ght-restore-'))
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(restoredRoot, { recursive: true, force: true })
  })
  const db = createFileDatabase(join(root, '.githuman/ght-reviews.db'))
  const original = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  const artifact = original.create(input(), ACTOR)
  original.updateMetadata(
    artifact.id,
    {
      requestId: 'edit',
      expectedVersion: 1,
      metadata: { title: 'Restored', tags: [] }
    },
    ACTOR
  )
  const expected = original.get(artifact.id)
  const history = original.history(artifact.id)
  const content = original.readContent(artifact.id)
  db.close()
  cpSync(join(root, '.githuman'), join(restoredRoot, '.githuman'), {
    recursive: true
  })
  const restoredDb = createFileDatabase(
    join(restoredRoot, '.githuman/ght-reviews.db')
  )
  t.after(() => restoredDb.close())
  const restored = new ArtifactStorageService({
    db: restoredDb,
    repositoryPath: restoredRoot,
    prefix: 'ght-'
  })
  restored.recover()
  restored.catalog.rebuild()
  assert.equal(restored.storeId, original.storeId)
  assert.deepEqual(restored.get(artifact.id), expected)
  assert.deepEqual(restored.history(artifact.id), history)
  assert.deepEqual(restored.readContent(artifact.id), content)
})

test('INSERT OR REPLACE cannot remove authoritative records through any unique key', t => {
  const { db, service } = setup(t)
  service.create(input(), ACTOR)
  for (const table of [
    'artifact_stores',
    'artifacts',
    'artifact_metadata_versions',
    'artifact_events',
    'artifact_operations',
    'artifact_operation_events'
  ]) {
    const before = db.prepare(`SELECT * FROM ${table}`).all()
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

test('independent processes serialize create and competing metadata changes', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ght-processes-'))
  const path = join(root, '.githuman/ght-reviews.db')
  const db = createFileDatabase(path)
  const service = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  t.after(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  async function workers() {
    return Promise.all(
      [0, 1].map(async () => {
        const child = fork(
          new URL('../fixtures/artifact-worker.ts', import.meta.url),
          [root, path],
          { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }
        )
        t.after(() => child.kill())
        await once(child, 'message')
        return child
      })
    )
  }
  const creators = await workers()
  const created = await Promise.all(
    creators.map(async (child, index) => {
      const result = once(child, 'message')
      child.send({ action: 'create', requestId: `create-${index}` })
      return (await result)[0] as { artifact: { id: string }; error?: string }
    })
  )
  assert.ok(created.every(result => result.artifact && !result.error))
  assert.equal(service.list().items.length, 2)
  const editors = await workers()
  const edited = await Promise.all(
    editors.map(async (child, index) => {
      const result = once(child, 'message')
      child.send({
        action: 'update',
        id: created[0].artifact.id,
        requestId: `edit-${index}`
      })
      return (await result)[0] as { error?: string }
    })
  )
  assert.equal(edited.filter(result => !result.error).length, 1)
  assert.equal(
    edited.filter(result => result.error === 'GHT_ARTIFACT_CONFLICT').length,
    1
  )
  assert.equal(service.history(created[0].artifact.id).items.length, 2)
})

test('recovery rechecks operation state after another process commits its stale snapshot', t => {
  const { db, root } = setup(t)
  let now = Date.now()
  const creator = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    now: () => now,
    checkpoint: phase => {
      if (phase === 'temp_synced') throw new Error('crash')
    }
  })
  assert.throws(() => creator.create(input(), ACTOR), /crash/)
  now += 31000
  const a = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    now: () => now
  })
  const b = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    now: () => now
  })
  const operations = a.catalog.operations.bind(a.catalog)
  a.catalog.operations = (...args) => {
    const stale = operations(...args)
    b.recover()
    return stale
  }
  assert.doesNotThrow(() => a.recover())
  assert.equal(a.list().items.length, 1)
  assert.equal(a.history(a.list().items[0].id).items.length, 1)
})

test('write lock exhaustion returns a retryable domain conflict', t => {
  const root = mkdtempSync(join(tmpdir(), 'ght-busy-'))
  const path = join(root, '.githuman/ght-reviews.db')
  const db1 = createFileDatabase(path)
  const db2 = createFileDatabase(path)
  t.after(() => {
    db2.close()
    db1.close()
    rmSync(root, { recursive: true, force: true })
  })
  const service = new ArtifactStorageService({
    db: db2,
    repositoryPath: root,
    prefix: 'ght-'
  })
  db2.exec('PRAGMA busy_timeout = 10')
  db1.exec('BEGIN IMMEDIATE')
  try {
    assert.throws(() => service.create(input(), ACTOR), ArtifactConflictError)
  } finally {
    db1.exec('ROLLBACK')
  }
  assert.equal(service.create(input(), ACTOR).metadataVersion, 1)
})

test('catalog page reads do not take a write lock and keep epoch and rows in one WAL snapshot', t => {
  const root = mkdtempSync(join(tmpdir(), 'ght-read-snapshot-'))
  const path = join(root, '.githuman/ght-reviews.db')
  const writerDb = createFileDatabase(path)
  const readerDb = createFileDatabase(path)
  t.after(() => {
    readerDb.close()
    writerDb.close()
    rmSync(root, { recursive: true, force: true })
  })
  const writer = new ArtifactStorageService({
    db: writerDb,
    repositoryPath: root,
    prefix: 'ght-'
  })
  const reader = new ArtifactStorageService({
    db: readerDb,
    repositoryPath: root,
    prefix: 'ght-'
  })
  writerDb.exec('PRAGMA busy_timeout=10')
  readerDb.exec('PRAGMA busy_timeout=10')
  const artifact = writer.create(input(), ACTOR)
  const epoch = writer.catalog.epoch()
  writer.catalog.transaction(() => {
    assert.deepEqual(reader.list().items, [artifact])
  })
  const readEpoch = reader.catalog.epoch.bind(reader.catalog)
  const spy = t.mock.method(reader.catalog, 'epoch', () => {
    const snapshotEpoch = readEpoch()
    writer.updateMetadata(
      artifact.id,
      {
        requestId: 'concurrent-edit',
        expectedVersion: 1,
        metadata: { title: 'Changed during page read', tags: [] }
      },
      ACTOR
    )
    return snapshotEpoch
  })
  const page = reader.list()
  assert.equal(page.storeEpoch, epoch)
  assert.deepEqual(page.items, [artifact])
  spy.mock.restore()
  assert.equal(reader.list().items[0].metadataVersion, 2)
  assert.ok(reader.list().storeEpoch > epoch)
})

test('replay accepts the same actor with a different property order', t => {
  const { service } = setup(t)
  const first = service.create(input(), ACTOR)
  assert.deepEqual(service.create(input(), SWAPPED_ACTOR), first)
  const update = {
    requestId: 'edit-1',
    expectedVersion: 1,
    metadata: { title: 'Новый план', tags: [] }
  }
  const second = service.updateMetadata(first.id, update, ACTOR)
  assert.deepEqual(
    service.updateMetadata(first.id, update, SWAPPED_ACTOR),
    second
  )
  assert.throws(
    () => service.create(input(), { ...SWAPPED_ACTOR, id: 'other' }),
    ArtifactConflictError
  )
  assert.equal(service.history(first.id).items.length, 2)
})

test('awaiting_retry operation continues with a reordered actor after restart', t => {
  const { root, db, service } = setup(t)
  let now = Date.now()
  const crashed = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    now: () => now,
    checkpoint: phase => {
      if (phase === 'reserved') throw new Error('crash')
    }
  })
  assert.throws(() => crashed.create(input(), ACTOR), /crash/)
  const operation = service.catalog.operation('create-1')!
  assert.deepEqual(operation.data.actor, ACTOR)
  assert.deepEqual(Object.keys(operation.data.actor), ['kind', 'id'])
  now += 31_000
  const restarted = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    now: () => now
  })
  assert.deepEqual(restarted.recover().awaitingRetry, [operation.artifactId])
  assert.equal(
    restarted.create(input(), SWAPPED_ACTOR).id,
    operation.artifactId
  )
})

// Leave two operations with a saved temporary file, then expire their leases.
function crashTwoAtTempSync(t: TestContext) {
  const { root, db, service } = setup(t)
  let now = Date.now()
  const crashed = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-',
    now: () => now,
    checkpoint: phase => {
      if (phase === 'temp_synced') throw new Error('crash')
    }
  })
  assert.throws(() => crashed.create(input('create-1'), ACTOR), /crash/)
  assert.throws(() => crashed.create(input('create-2'), ACTOR), /crash/)
  now += 31_000
  const ids = ['create-1', 'create-2'].map(
    id => service.catalog.operation(id)!.artifactId
  )
  const restart = (fail: (artifactId: string) => boolean) =>
    new ArtifactStorageService({
      db,
      repositoryPath: root,
      prefix: 'ght-',
      now: () => now,
      checkpoint: (phase, reservation) => {
        if (phase === 'temp_synced' && fail(reservation.artifact.id)) {
          throw new Error(`disk ${reservation.artifact.id}`)
        }
      }
    })
  return { db, ids, restart }
}

test('recovery continues after an unexpected failure and releases its lease', t => {
  const { db, ids, restart } = crashTwoAtTempSync(t)
  const restarted = restart(id => id === ids[0])
  assert.throws(() => restarted.recover(), new RegExp(`disk ${ids[0]}`))
  assert.deepEqual(
    restarted.list().items.map(item => item.id),
    [ids[1]]
  )
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM artifact_operation_leases').get()!.n,
    0
  )
})

test('recovery reports every unexpected failure after the full pass', t => {
  const { ids, restart } = crashTwoAtTempSync(t)
  const restarted = restart(() => true)
  assert.throws(
    () => restarted.recover(),
    error =>
      error instanceof AggregateError &&
      error.errors.length === 2 &&
      ids.every(id => error.message.includes(id))
  )
})

test('catalog pages use the order index without a temporary sort', t => {
  const { db, service } = setup(t)
  service.create(input('a'), ACTOR)
  const plan = db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT c.snapshot_json FROM artifact_current c
      JOIN artifacts a ON a.store_id=c.store_id AND a.id=c.artifact_id
      WHERE c.store_id=? AND (? IS NULL OR (a.created_at,a.id)>(?,?))
      ORDER BY a.created_at,a.id LIMIT ?`
    )
    .all(service.storeId, null, '', '', 10)
    .map(row => String(row.detail))
    .join('\n')
  assert.doesNotMatch(plan, /TEMP B-TREE/)
})

test('INSERT OR REPLACE with an explicit rowid cannot overwrite a record', t => {
  const { db, service } = setup(t)
  service.create(input(), ACTOR)
  for (const table of ['artifact_metadata_versions', 'artifact_operations']) {
    const before = db.prepare(`SELECT rowid, * FROM ${table}`).all()
    const row = before[0] as Record<string, unknown>
    const columns = Object.keys(row).filter(name => name !== 'rowid')
    // Change every key column so only the rowid can match the stored record.
    const values = columns.map(name =>
      name === 'version'
        ? 99
        : typeof row[name] === 'string'
          ? `x-${row[name]}`
          : row[name]
    )
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT OR REPLACE INTO ${table}(rowid, ${columns.join(',')}) VALUES (?${',?'.repeat(columns.length)})`
          )
          .run(row.rowid as number, ...(values as (string | number)[])),
      /immutable/
    )
    assert.deepEqual(db.prepare(`SELECT rowid, * FROM ${table}`).all(), before)
  }
})

test('source paths survive creation, metadata edits, retries and history without rewriting originals', t => {
  const { root, service } = setup(t)
  const sourcePath = 'documents/план.md'
  const create = { ...input(), metadata: { ...input().metadata, sourcePath } }
  const first = service.create(create, ACTOR)
  const path = join(root, '.githuman/artifacts', `ght-${first.id}.md`)
  const bytes = readFileSync(path)
  assert.equal(
    parse(bytes.toString('utf8').slice(4).split('---\n')[0]).source_path,
    sourcePath
  )
  assert.equal(first.sourcePath, sourcePath)
  assert.deepEqual(service.create(create, ACTOR), first)
  assert.throws(
    () =>
      service.create(
        { ...create, metadata: { ...create.metadata, sourcePath: 'other.md' } },
        ACTOR
      ),
    ArtifactConflictError
  )
  const edit = {
    requestId: 'source-edit',
    expectedVersion: 1,
    metadata: { title: 'Clean title', tags: [] }
  }
  const second = service.updateMetadata(first.id, edit, ACTOR)
  assert.equal(second.sourcePath, sourcePath)
  const update = {
    requestId: 'source-change',
    expectedVersion: 2,
    metadata: { title: second.title, tags: [], sourcePath: 'archive/план.md' }
  }
  const third = service.updateMetadata(first.id, update, ACTOR)
  assert.deepEqual(service.updateMetadata(first.id, update, ACTOR), third)
  assert.throws(
    () =>
      service.updateMetadata(
        first.id,
        { ...update, metadata: { ...update.metadata, sourcePath } },
        ACTOR
      ),
    ArtifactConflictError
  )
  assert.equal(service.get(first.id).sourcePath, update.metadata.sourcePath)
  assert.deepEqual(
    service.history(first.id).items.map(event => event.metadata.sourcePath),
    [sourcePath, sourcePath, update.metadata.sourcePath]
  )
  service.catalog.rebuild()
  assert.equal(service.get(first.id).sourcePath, update.metadata.sourcePath)
  assert.equal(third.sha256, first.sha256)
  assert.deepEqual(readFileSync(path), bytes)
})
