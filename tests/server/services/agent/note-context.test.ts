import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestDatabase } from '../../../../src/server/db/index.ts'
import { createEventBus } from '../../../../src/server/event-bus.ts'
import { NotesService } from '../../../../src/server/services/notes.service.ts'
import { buildPromptBlocks } from '../../../../src/server/services/agent/context-builder.ts'

for (const embeddedContext of [true, false]) {
  test(`note context reads current source by identity (embedded=${embeddedContext})`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'note-context-'))
    const db = createTestDatabase()
    const notes = new NotesService(
      root,
      join(root, 'outside-repo'),
      false,
      createEventBus(),
      db
    )
    t.after(async () => {
      await notes.identity.close()
      db.close()
      await rm(root, { recursive: true, force: true })
    })
    const note = await notes.save('first.md', 'Initial')
    assert.ok(note.id)
    assert.ok(note.storageId)
    const context = [
      {
        kind: 'note' as const,
        noteId: note.id,
        storageId: note.storageId,
        name: 'first.md'
      }
    ]
    await notes.rename('first.md', 'renamed.md', false)
    const current = await notes.identity.readId(note.id, note.storageId)
    const text = '---\ntitle: Updated\n---\nLatest body'
    await notes.save(
      current.path,
      text,
      current.version,
      note.id,
      note.storageId
    )
    const deps = {
      db,
      notes,
      repositoryPath: join(root, 'repo'),
      embeddedContext,
      image: false,
      attachmentDir: join(root, 'attachments')
    }
    const blocks = await buildPromptBlocks({ text: 'Read this', context }, deps)
    assert.deepEqual(blocks[0], { type: 'text', text: 'Read this' })
    const block = blocks[1]
    assert.ok(block)
    if (embeddedContext) {
      assert.equal(block.type, 'resource')
      if (block.type !== 'resource') return
      assert.equal(block.resource.mimeType, 'text/markdown')
      assert.ok('text' in block.resource)
      assert.match(block.resource.text, /renamed.md/)
      assert.ok(block.resource.text.includes(text))
    } else {
      assert.equal(block.type, 'text')
      if (block.type !== 'text') return
      assert.ok(block.text.includes(text))
      assert.match(block.text, /renamed.md/)
    }
    await assert.rejects(
      buildPromptBlocks(
        {
          text: 'Read',
          context: [{ ...context[0], storageId: 'wrong-storage' }]
        },
        deps
      )
    )
    await rm(join(notes.root, 'renamed.md'))
    await assert.rejects(buildPromptBlocks({ text: 'Read', context }, deps))
  })
}
