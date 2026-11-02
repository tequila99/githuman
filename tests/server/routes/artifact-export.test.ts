import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../../../src/server/app.ts'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'
import { ArtifactExportService } from '../../../src/server/services/artifact-export.service.ts'
import type { ArtifactMetadataExport } from '../../../src/shared/artifacts/types.ts'

const actor = { kind: 'user' as const, id: 'local' }
function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'artifact-export-'))
  const db = createTestDatabase()
  const storage = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  const app = buildApp({ db, repositoryPath: root, artifacts: storage })
  t.after(async () => {
    await app.close()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  const document = storage.create(
    {
      requestId: 'create',
      body: '# Текст 🧪\r\nOriginal\r\n',
      metadata: { title: 'Original', tags: ['initial'] }
    },
    actor
  )
  const rename = (title: string) =>
    storage.updateMetadata(
      document.id,
      {
        requestId: randomUUID(),
        expectedVersion: storage.get(document.id).metadataVersion,
        metadata: { title, tags: [title] }
      },
      actor
    )
  return {
    root,
    db,
    app,
    storage,
    document,
    rename,
    exports: new ArtifactExportService(storage)
  }
}
test('original export preserves exact UTF-8/CRLF bytes and historical frontmatter after metadata changes', async t => {
  const { app, storage, document, rename } = setup(t)
  const before = storage.readVerifiedFile(document.id).content
  rename('Current title')
  const response = await app.inject(
    `/api/artifacts/${document.id}/export?format=original`
  )
  assert.equal(response.statusCode, 200, response.body)
  assert.deepEqual(response.rawPayload, before)
  assert.equal(
    createHash('sha256').update(response.rawPayload).digest('hex'),
    document.sha256
  )
  assert.equal(response.headers['x-artifact-sha256'], document.sha256)
  assert.match(response.headers['content-type'] ?? '', /text\/markdown/)
  assert.equal(
    response.headers['content-disposition'],
    `attachment; filename="artifact-${document.id}.md"`
  )
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(storage.get(document.id).title, 'Current title')
  assert.equal(storage.get(document.id).sha256, document.sha256)
})
test('metadata export streams complete history beyond API pagination limits and includes full status snapshots', async t => {
  const { app, storage, document, rename } = setup(t)
  for (let index = 0; index < 120; index++) rename('Title ' + index)
  const current = storage.get(document.id)
  storage.catalog.transaction(() =>
    storage.catalog.appendMetadata(
      {
        ...current,
        status: 'archived',
        metadataVersion: current.metadataVersion + 1
      },
      'archive',
      actor,
      'metadata_updated'
    )
  )
  const response = await app.inject(
    `/api/artifacts/${document.id}/export?format=metadata-history`
  )
  assert.equal(response.statusCode, 200, response.body)
  const value = response.json<ArtifactMetadataExport>()
  assert.equal(value.formatVersion, 1)
  assert.equal(value.storeId, storage.storeId)
  assert.equal(value.artifactId, document.id)
  assert.equal(value.storeEpoch, storage.catalog.epoch())
  assert.equal(value.snapshotSeq, storage.catalog.eventSequence())
  assert.deepEqual(value.artifact, storage.get(document.id))
  assert.equal(value.history.length, 122)
  assert.equal(value.history[0]?.snapshot.status, 'draft')
  assert.equal(value.history.at(-1)?.snapshot.status, 'archived')
  assert.deepEqual(value.history.at(-1)?.snapshot, value.artifact)
  for (let index = 0; index < value.history.length; index++) {
    const event = value.history[index]
    assert.equal(event.afterVersion, index + 1)
    assert.equal(event.snapshot.metadataVersion, event.afterVersion)
    assert.equal(event.snapshot.id, document.id)
    assert.equal(event.artifactId, document.id)
    assert.equal(event.storeId, storage.storeId)
    assert.ok(event.seq <= value.snapshotSeq)
  }
  assert.equal(
    response.headers['content-disposition'],
    `attachment; filename="artifact-${document.id}.metadata-history.json"`
  )
  assert.equal(response.headers['cache-control'], 'no-store')
})
test('streamed history stays at its captured metadata/epoch/sequence when new events are committed before consumption', async t => {
  const { storage, document, rename, exports } = setup(t)
  rename('At snapshot')
  const captured = storage.get(document.id)
  const epoch = storage.catalog.epoch()
  const seq = storage.catalog.eventSequence()
  const stream = exports.metadataHistory(document.id)
  rename('Later title')
  storage.create(
    {
      requestId: 'other',
      body: 'Other',
      metadata: { title: 'Other', tags: [] }
    },
    actor
  )
  let text = ''
  for await (const chunk of stream) text += chunk.toString()
  const value: ArtifactMetadataExport = JSON.parse(text)
  assert.deepEqual(value.artifact, captured)
  assert.equal(value.storeEpoch, epoch)
  assert.equal(value.snapshotSeq, seq)
  assert.equal(value.history.length, 2)
  assert.ok(!text.includes('Later title'))
  assert.equal(storage.get(document.id).title, 'Later title')
})
test('export validates access, identity and format before opening a download', async t => {
  const { app, document } = setup(t)
  for (const query of ['', '?format=unknown']) {
    assert.equal(
      (await app.inject(`/api/artifacts/${document.id}/export${query}`))
        .statusCode,
      400
    )
  }
  for (const format of ['original', 'metadata-history']) {
    assert.equal(
      (await app.inject(`/api/artifacts/not-a-uuid/export?format=${format}`))
        .statusCode,
      400
    )
    assert.equal(
      (
        await app.inject(
          `/api/artifacts/${randomUUID()}/export?format=${format}`
        )
      ).statusCode,
      404
    )
    const denied = await app.inject({
      url: `/api/artifacts/${document.id}/export?format=${format}`,
      remoteAddress: '192.0.2.10',
      headers: { host: 'evil.example' }
    })
    assert.equal(denied.statusCode, 403)
  }
})
test('a corrupted original fails as an integrity error while its metadata audit remains available', async t => {
  const { app, root, document } = setup(t)
  writeFileSync(
    join(root, '.githuman/artifacts', `ght-${document.id}.md`),
    'Changed'
  )
  const response = await app.inject(
    `/api/artifacts/${document.id}/export?format=original`
  )
  assert.equal(response.statusCode, 422)
  assert.equal(response.json().code, 'GHT_ARTIFACT_INTEGRITY')
  assert.equal(response.headers['content-disposition'], undefined)
  const metadata = await app.inject(
    `/api/artifacts/${document.id}/export?format=metadata-history`
  )
  assert.equal(metadata.statusCode, 200, metadata.body)
  assert.equal(metadata.json<ArtifactMetadataExport>().history.length, 1)
})

test('archived and deleted artifacts keep both original and metadata history exports', async t => {
  const { app, storage, document } = setup(t)
  const original = storage.readVerifiedFile(document.id).content
  for (const status of ['archived', 'deleted'] as const) {
    const previous = storage.get(document.id)
    storage.catalog.transaction(() =>
      storage.catalog.appendMetadata(
        { ...previous, metadataVersion: previous.metadataVersion + 1, status },
        'status-' + status,
        actor,
        'metadata_updated'
      )
    )
    const file = await app.inject(
      `/api/artifacts/${document.id}/export?format=original`
    )
    assert.equal(file.statusCode, 200, file.body)
    assert.deepEqual(file.rawPayload, original)
    const metadata = await app.inject(
      `/api/artifacts/${document.id}/export?format=metadata-history`
    )
    assert.equal(metadata.statusCode, 200, metadata.body)
    assert.equal(
      metadata.json<ArtifactMetadataExport>().history.at(-1)?.snapshot.status,
      status
    )
  }
})
test('cancelling a history stream stops reading its remaining pages', async t => {
  const { storage, document, exports } = setup(t)
  const read = t.mock.method(storage.catalog, 'exportHistory')
  const stream = exports.metadataHistory(document.id)
  stream.once('data', () => stream.destroy())
  await new Promise<void>(resolve => stream.once('close', resolve))
  assert.ok(read.mock.callCount() <= 1)
  assert.equal(stream.destroyed, true)
})

for (const missingVersion of [false, true]) {
  test(`metadata export rejects missing version snapshots before sending headers (missing afterVersion=${missingVersion})`, async t => {
    const { app, storage, document, db } = setup(t)
    const event = storage.catalog.history(document.id, 0, 1)[0]
    const payload = missingVersion
      ? Object.fromEntries(
          Object.entries(event).filter(([key]) => key !== 'afterVersion')
        )
      : { ...event, afterVersion: 999 }
    db.prepare(
      'INSERT INTO artifact_events(store_id,artifact_id,request_id,data_json) VALUES(?,?,?,?)'
    ).run(
      storage.storeId,
      document.id,
      'broken-export-event',
      JSON.stringify(payload)
    )
    const response = await app.inject(
      `/api/artifacts/${document.id}/export?format=metadata-history`
    )
    assert.equal(response.statusCode, 422)
    assert.equal(response.json().code, 'GHT_ARTIFACT_INTEGRITY')
    assert.equal(response.headers['content-disposition'], undefined)
  })
}
