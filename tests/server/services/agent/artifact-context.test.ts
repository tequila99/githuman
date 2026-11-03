import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestDatabase } from '../../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../../src/server/services/artifact-storage.service.ts'
import {
  buildPromptBlocks,
  MAX_EMBEDDED_CHARS
} from '../../../../src/server/services/agent/context-builder.ts'

// Metadata is capped at 65536 bytes. Each graph page adds <=50 edges at 140 bytes and 1024 bytes for framing/cursor.
// Another 4096 bytes cover artifact identity and continuation instructions.
const MAX_ARTIFACT_CONTEXT_PREFIX_BYTES = 85680

for (const embeddedContext of [true, false]) {
  test(`artifact context preserves current metadata, both link pages and continuation (embedded=${embeddedContext})`, async t => {
    const root = mkdtempSync(join(tmpdir(), 'artifact-context-'))
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
    const actor = { kind: 'user' as const, id: 'local' }
    const related = storage.create(
      {
        requestId: 'related',
        body: 'RELATED_SECRET_BODY',
        metadata: { title: 'Related', tags: [] }
      },
      actor
    )
    const body = 'Я 🧪\r\n' + 'x'.repeat(MAX_EMBEDDED_CHARS + 10)
    const document = storage.create(
      {
        requestId: 'main',
        body,
        metadata: {
          title: 'Original title',
          tags: [],
          relations: [{ kind: 'references', targetId: related.id }]
        }
      },
      actor
    )
    storage.updateMetadata(
      document.id,
      {
        requestId: 'rename',
        expectedVersion: 1,
        metadata: {
          title: 'Current title',
          tags: ['current'],
          relations: document.relations
        }
      },
      actor
    )
    for (let i = 0; i < 51; i++) {
      storage.create(
        {
          requestId: 'incoming-' + i,
          body: 'INCOMING_SECRET_BODY',
          metadata: {
            title: 'Incoming',
            tags: [],
            relations: [{ kind: 'references', targetId: document.id }]
          }
        },
        actor
      )
    }
    const item = {
      kind: 'artifact' as const,
      storeId: storage.storeId,
      artifactId: document.id,
      name: 'Client title is not authoritative'
    }
    const deps = {
      db,
      artifacts: storage,
      repositoryPath: root,
      embeddedContext,
      image: false,
      attachmentDir: join(root, 'attachments')
    }
    const blocks = await buildPromptBlocks(
      { text: 'Read', context: [item] },
      deps
    )
    assert.equal(blocks.length, 2)
    const block = blocks[1]
    let text: string
    if (block.type === 'resource') {
      assert.ok('text' in block.resource)
      text = block.resource.text
      assert.equal(
        block.resource.uri,
        `githuman://artifact/${storage.storeId}/${document.id}`
      )
    } else {
      assert.equal(block.type, 'text')
      if (block.type !== 'text') return
      text = block.text
    }
    assert.ok(text.includes('Current title'))
    assert.ok(text.includes('"metadataVersion":2'))
    assert.ok(text.includes('"tags":["current"]'))
    assert.ok(text.includes(related.id))
    assert.ok(text.includes('"incoming":'))
    assert.ok(text.includes('"nextCursor":"'))
    assert.ok(text.includes('artifacts.get_content'))
    assert.ok(text.includes('/#/artifacts?storeId='))
    assert.ok(text.includes('Я 🧪\r\n'))
    assert.match(text, /truncated by githuman/)
    assert.ok(!text.includes('RELATED_SECRET_BODY'))
    assert.ok(!text.includes('INCOMING_SECRET_BODY'))
    assert.ok(!text.includes('Original title'))
    await assert.rejects(
      buildPromptBlocks(
        { text: 'Read', context: [{ ...item, storeId: 'another-store' }] },
        deps
      )
    )
    await assert.rejects(
      buildPromptBlocks(
        { text: 'Read', context: [item] },
        { ...deps, artifacts: undefined }
      )
    )
    writeFileSync(
      join(root, '.githuman', 'artifacts', `ght-${document.id}.md`),
      'corrupted'
    )
    await assert.rejects(
      buildPromptBlocks({ text: 'Read', context: [item] }, deps)
    )
  })
}

test('maximum metadata fields and two full link pages preserve a bounded prefix and body continuation', async t => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-context-bound-'))
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
  const actor = { kind: 'user' as const, id: 'local' }
  const typeId = 't'.repeat(100)
  storage.types.create(
    'bound-type',
    typeId,
    { label: 'Bound type', active: true },
    actor
  )
  const tasks = Array.from(
    { length: 100 },
    (_, index) =>
      storage.tasks.create(
        'bound-task-' + index,
        { title: 'Task ' + index, externalUrl: null, state: 'open' },
        actor
      ).id
  )
  const targets = Array.from({ length: 200 }, (_, index) =>
    storage.create(
      {
        requestId: 'bound-target-' + index,
        body: 'Related body must not be embedded.',
        metadata: { title: 'Target ' + index, tags: [] }
      },
      actor
    )
  )
  const document = storage.create(
    {
      requestId: 'bound-document',
      body: 'Body marker\n' + 'x'.repeat(MAX_EMBEDDED_CHARS + 100),
      metadata: {
        title: 'T' + '\u0001'.repeat(999),
        typeId,
        taskIds: tasks,
        tags: Array.from(
          { length: 100 },
          (_, index) =>
            String(index).padStart(3, '0') +
            (index < 20 ? '\u0001' : 't').repeat(125)
        ),
        relations: targets.map(item => ({
          kind: 'references' as const,
          targetId: item.id
        }))
      }
    },
    actor
  )
  for (const [index, item] of targets.slice(0, 51).entries()) {
    storage.updateMetadata(
      item.id,
      {
        requestId: 'bound-incoming-' + index,
        expectedVersion: 1,
        metadata: {
          title: item.title,
          tags: [],
          relations: [{ kind: 'references', targetId: document.id }]
        }
      },
      actor
    )
  }
  const blocks = await buildPromptBlocks(
    {
      text: 'Read',
      context: [
        {
          kind: 'artifact',
          artifactId: document.id,
          storeId: storage.storeId,
          name: 'Bound'
        }
      ]
    },
    {
      db,
      artifacts: storage,
      repositoryPath: root,
      embeddedContext: true,
      image: false,
      attachmentDir: join(root, 'attachments')
    }
  )
  const block = blocks[1]
  assert.ok(block?.type === 'resource' && 'text' in block.resource)
  const text = block.resource.text
  const start = text.indexOf('Document body:\n') + 'Document body:\n'.length
  const prefix = text.slice(0, start)
  assert.ok(Buffer.byteLength(prefix) <= MAX_ARTIFACT_CONTEXT_PREFIX_BYTES)
  const snapshot = storage.graph.readDocumentContext(document.id)
  assert.equal(snapshot.artifact.title.length, 1000)
  assert.equal(snapshot.artifact.tags.length, 100)
  assert.equal(snapshot.artifact.taskIds.length, 100)
  assert.equal(snapshot.artifact.relations.length, 200)
  assert.equal(snapshot.outgoing.items.length, 50)
  assert.equal(snapshot.incoming.items.length, 50)
  assert.ok(snapshot.outgoing.nextCursor && snapshot.incoming.nextCursor)
  assert.ok(
    prefix.includes('artifacts.get_content') && prefix.includes('nextOffset')
  )
  assert.ok(text.slice(start).startsWith('Body marker\n'))
  assert.match(text.slice(start), /truncated by githuman/)
  assert.ok(!text.includes('Related body must not be embedded.'))
})
