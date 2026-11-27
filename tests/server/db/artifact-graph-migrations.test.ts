import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { stringify } from 'yaml'
import { applyArtifactMigrations } from '../../../src/server/db/artifact-migrations.ts'
import { applyArtifactGraphMigrations } from '../../../src/server/db/artifact-graph-migrations.ts'
import { applyMigrations } from '../../../src/server/db/migrations.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'

// This fixture writes the 0088 schema and JSON shape without graph fields.
test('0088 committed and pending operations retain their bytes, identity, history and replay after upgrade', t => {
  const root = mkdtempSync(join(tmpdir(), 'ght-legacy-'))
  const db = new DatabaseSync(':memory:')
  t.after(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  applyArtifactMigrations(db)
  const storeId = randomUUID(),
    actor = { kind: 'agent' as const, id: 'legacy' }
  db.prepare('INSERT INTO artifact_stores VALUES(?,?,?,1)').run(
    storeId,
    root,
    'ght-'
  )
  db.prepare('INSERT INTO artifact_store_epochs VALUES(?,1)').run(storeId)
  mkdirSync(join(root, '.githuman/artifacts'), { recursive: true })
  const fixtures = ['committed', 'pending'].map((state, index) => {
    const id = randomUUID(),
      createdAt = '2026-10-26T00:00:00.000Z',
      title = `Legacy ${state}`,
      body = 'Body\r\n🧪\n',
      requestId = `legacy-${state}`
    const header = stringify({
      schema_version: 1,
      store_id: storeId,
      artifact_id: id,
      title,
      type_id: 'generic',
      status: 'draft',
      created_at: createdAt,
      metadata_updated_at: createdAt,
      task_ids: [],
      tags: [],
      relations: [],
      revision_of: []
    })
    const text = `---\n${header}---\n${body}`
    const sha256 = createHash('sha256').update(text).digest('hex')
    const artifact = {
      storeId,
      id,
      title,
      tags: [],
      typeId: 'generic',
      status: 'draft',
      createdAt,
      metadataUpdatedAt: createdAt,
      metadataVersion: 1,
      sha256,
      bytes: Buffer.byteLength(text),
      bodyStartLine: `---\n${header}---\n`.split('\n').length
    }
    const fileName = `ght-${id}.md`,
      tempName = `${fileName}.${randomUUID()}.tmp`,
      data = { artifact, fileName, tempName, actor }
    const hash = createHash('sha256')
      .update(JSON.stringify({ kind: 'create', body, title, tags: [], actor }))
      .digest('hex')
    db.prepare('INSERT INTO artifact_operations VALUES(?,?,?,?,?,?)').run(
      storeId,
      requestId,
      'create',
      hash,
      id,
      JSON.stringify(data)
    )
    db.prepare(
      'INSERT INTO artifact_operation_events(store_id,request_id,state,created_at) VALUES(?,?,?,?)'
    ).run(storeId, requestId, state, createdAt)
    writeFileSync(join(root, '.githuman/artifacts', fileName), text)
    if (index === 0) {
      db.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?,?)').run(
        storeId,
        id,
        fileName,
        sha256,
        artifact.bytes,
        artifact.bodyStartLine,
        createdAt
      )
      db.prepare(
        'INSERT INTO artifact_metadata_versions VALUES(?,?,?,?,?)'
      ).run(storeId, id, 1, requestId, JSON.stringify(artifact))
      db.prepare('INSERT INTO artifact_current VALUES(?,?,?,?)').run(
        storeId,
        id,
        1,
        JSON.stringify(artifact)
      )
      const event = {
        storeId,
        artifactId: id,
        requestId,
        actor,
        action: 'created',
        beforeVersion: null,
        afterVersion: 1,
        createdAt,
        metadata: { title, tags: [] }
      }
      db.prepare(
        'INSERT INTO artifact_events(store_id,artifact_id,request_id,data_json) VALUES(?,?,?,?)'
      ).run(storeId, id, requestId, JSON.stringify(event))
    }
    return { id, requestId, body, title, text, fileName }
  })
  const originalVersions = db
    .prepare('SELECT * FROM artifact_metadata_versions')
    .all()
  const originalHistory = db.prepare('SELECT * FROM artifact_events').all()
  applyMigrations(db)
  applyMigrations(db)
  const storage = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  assert.equal(storage.storeId, storeId)
  assert.deepEqual(storage.get(fixtures[0].id).taskIds, [])
  assert.deepEqual(storage.get(fixtures[0].id).relations, [])
  assert.deepEqual(storage.get(fixtures[0].id).revisionOf, [])
  assert.equal(storage.list().items.length, 1)
  assert.equal(storage.catalog.epoch(), 1)
  assert.deepEqual(storage.recover().recovered, [fixtures[1].id])
  for (const item of fixtures) {
    const replay = storage.create(
      {
        requestId: item.requestId,
        body: item.body,
        metadata: { title: item.title, tags: [] }
      },
      actor
    )
    assert.equal(replay.id, item.id)
    assert.equal(storage.readContent(item.id).text, item.text)
    assert.equal(
      readFileSync(join(root, '.githuman/artifacts', item.fileName), 'utf8'),
      item.text
    )
    assert.equal(storage.history(item.id).items.length, 1)
  }
  assert.deepEqual(
    db
      .prepare(
        'SELECT * FROM artifact_metadata_versions ORDER BY rowid LIMIT 1'
      )
      .all(),
    originalVersions
  )
  assert.deepEqual(
    db.prepare('SELECT * FROM artifact_events ORDER BY seq LIMIT 1').all(),
    originalHistory
  )
  storage.catalog.rebuild()
  assert.equal(storage.catalog.epoch(), 2)
})

test('the 0088 history is copied into the change journal once', t => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  applyArtifactMigrations(db)
  db.exec(`INSERT INTO artifact_events(store_id,artifact_id,request_id,data_json)
    VALUES ('s','a','r1','{}'),('s','b','r2','{}')`)
  applyArtifactGraphMigrations(db)
  const copied = db
    .prepare('SELECT seq FROM artifact_store_changes ORDER BY seq')
    .all()
    .map(row => row.seq)
  assert.deepEqual(copied, [1, 2])
  db.exec(`INSERT INTO artifact_events(store_id,artifact_id,request_id,data_json)
    VALUES ('s','c','r3','{}')`)
  applyArtifactGraphMigrations(db)
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM artifact_store_changes').get()!.n,
    2
  )
})

test('validation relevance upgrades old journal rows conservatively and preserves later exclusions', t => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  applyArtifactMigrations(db)
  db.exec(`CREATE TABLE artifact_store_changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL,
    entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL, request_id TEXT NOT NULL,
    UNIQUE(store_id,entity_kind,request_id));
    INSERT INTO artifact_store_changes VALUES(1,'store','artifact','a','a'),(2,'store','artifact','b','b');`)
  applyArtifactGraphMigrations(db)
  assert.deepEqual(
    db
      .prepare(
        'SELECT validation_relevant FROM artifact_store_changes ORDER BY seq'
      )
      .all()
      .map(row => row.validation_relevant),
    [1, 1]
  )
  db.exec(
    `INSERT INTO artifact_store_changes(store_id,entity_kind,entity_id,request_id,validation_relevant) VALUES('store','artifact','report','report',0)`
  )
  applyMigrations(db)
  applyMigrations(db)
  assert.equal(
    db
      .prepare(
        'SELECT MAX(seq) epoch FROM artifact_store_changes WHERE validation_relevant=1'
      )
      .get()!.epoch,
    2
  )
  assert.equal(
    db
      .prepare(
        'SELECT validation_relevant FROM artifact_store_changes WHERE request_id=?'
      )
      .get('report')!.validation_relevant,
    0
  )
  assert.throws(
    () => db.exec('UPDATE artifact_store_changes SET validation_relevant=0'),
    /immutable/
  )
})

test('task creation times are copied into task_current and indexed once', t => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  applyArtifactMigrations(db)
  db.exec(`CREATE TABLE task_versions (
    store_id TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL,
    request_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, actor_json TEXT NOT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY(store_id,id,version), UNIQUE(store_id,request_id));
    CREATE TABLE task_current (
    store_id TEXT NOT NULL, id TEXT NOT NULL, snapshot_json TEXT NOT NULL,
    PRIMARY KEY(store_id,id));
    INSERT INTO task_versions VALUES
      ('s','legacy',1,'r1','{}','{}','2026-01-01T00:00:00.000Z'),
      ('s','legacy',2,'r2','{}','{}','2026-03-01T00:00:00.000Z'),
      ('s','current',1,'r3','{}','{}','2026-01-05T00:00:00.000Z');
    INSERT INTO task_current VALUES
      ('s','legacy','{"id":"legacy"}'),
      ('s','current','{"id":"current","createdAt":"2026-02-01T00:00:00.000Z"}'),
      ('s','orphan','{"id":"orphan"}');`)
  const read = () =>
    db
      .prepare('SELECT id,created_at FROM task_current ORDER BY id')
      .all()
      .map(row => [row.id, row.created_at])
  applyArtifactGraphMigrations(db)
  // The snapshot time has priority; a row without versions stays empty.
  const expected = [
    ['current', '2026-02-01T00:00:00.000Z'],
    ['legacy', '2026-01-01T00:00:00.000Z'],
    ['orphan', null]
  ]
  assert.deepEqual(read(), expected)
  applyArtifactGraphMigrations(db)
  assert.deepEqual(read(), expected)
  assert.ok(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='index' AND name='task_current_created'"
      )
      .get()
  )
})
