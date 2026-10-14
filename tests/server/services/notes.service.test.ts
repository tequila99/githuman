import { splitNote } from '../../../src/shared/notes/document.ts'
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { NotesService } from '../../../src/server/services/notes.service.ts'
import { createEventBus } from '../../../src/server/event-bus.ts'

test('notes index reuses unchanged metadata and detects external edits and removals', async t => {
  const project = await mkdtemp(join(tmpdir(), 'notes-index-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const root = join(project, 'notes')
  await mkdir(root)
  const path = join(root, 'a.md')
  await writeFile(path, '---\ntags: [first]\n---\nBody')
  const service = new NotesService(project, root, false, createEventBus())
  const read = mock.method(service.repository, 'read')
  t.after(() => read.mock.restore())
  const first = await service.snapshot()
  assert.equal(read.mock.callCount(), 1)
  assert.deepEqual((await service.index()).entries[0]?.tags, ['first'])
  assert.equal(read.mock.callCount(), 1)
  await writeFile(path, '---\ntags: [second]\n---\nChanged body')
  assert.notEqual(await service.snapshot(), first)
  assert.deepEqual((await service.index()).entries[0]?.tags, ['second'])
  assert.equal(read.mock.callCount(), 2)
  await rm(path)
  assert.deepEqual((await service.index()).entries, [])
})

test('rename preserves folder contents and rejects occupied and unsafe names', async t => {
  const project = await mkdtemp(join(tmpdir(), 'notes-rename-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const service = new NotesService(
    project,
    join(project, 'notes'),
    false,
    createEventBus()
  )
  await service.save('folder/a.md', 'Body')
  await service.rename('folder/a.md', 'b.md', false)
  assert.equal(splitNote((await service.read('folder/b.md')).text).body, 'Body')
  await service.rename('folder', 'renamed', true)
  assert.equal(
    splitNote((await service.read('renamed/b.md')).text).body,
    'Body'
  )
  await service.save('renamed/occupied.md', 'Keep')
  await assert.rejects(service.rename('renamed/b.md', 'occupied.md', false), {
    statusCode: 409
  })
  assert.equal(
    splitNote((await service.read('renamed/occupied.md')).text).body,
    'Keep'
  )
  for (const name of ['../escape.md', '.hidden.md', 'a/b.md', 'assets']) {
    await assert.rejects(service.rename('renamed', name, true), {
      statusCode: 400
    })
  }
  await assert.rejects(service.rename('renamed/b.md', 'wrong.md', true), {
    statusCode: 400
  })
})
