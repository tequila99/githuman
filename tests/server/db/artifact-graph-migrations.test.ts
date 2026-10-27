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
