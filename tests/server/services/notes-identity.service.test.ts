import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rename,
  rm
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotesService } from '../../../src/server/services/notes.service.ts'
import { createEventBus } from '../../../src/server/event-bus.ts'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { splitNote } from '../../../src/shared/notes/document.ts'

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const project = await mkdtemp(join(tmpdir(), 'note-identity-'))
  const root = join(project, 'notes')
  await mkdir(root)
  const db = createTestDatabase()
  const service = new NotesService(project, root, false, createEventBus(), db)
  t.after(async () => {
    await service.identity.close()
    db.close()
    await rm(project, { recursive: true, force: true })
  })
  return { service, root, db }
}

test('registration is read-only, optional IDs retain identity, and routes reject wrong storage', async t => {
  const { service, root } = await setup(t)
  await writeFile(join(root, 'a.md'), '# A')
  const first = await service.read('a.md')
  assert.ok(first.id)
  assert.equal(await readFile(join(root, 'a.md'), 'utf8'), '# A')
  const saved = await service.save('a.md', '# Changed', first.version)
  assert.equal(saved.id, first.id)
  await assert.rejects(
    service.identity.readId(first.id, '00000000-0000-4000-8000-000000000000'),
    { statusCode: 400 }
  )
})

test('rename and move preserve UUID and patch both directions, resources and reference links', async t => {
  const { service } = await setup(t)
  const b = await service.save('folder/B.md', '# B')
  const a = await service.save(
    'A.md',
    '[B](folder/B.md#heading)\n\n[B2][b]\n\n[b]: folder/B.md "title"'
  )
  await service.rename('folder/B.md', 'C.md', false)
  const moved = await service.read('folder/C.md')
  assert.equal(moved.id, b.id)
  assert.ok((await service.read('A.md')).text.includes('folder/C.md#heading'))
  const disk = await service.read('folder/C.md')
  await service.save(
    disk.path,
    disk.text +
      '\n[A](../A.md) ![local](../assets/pic.png) ![server](/api/notes/assets/test.png)',
    disk.version
  )
  await service.rename('folder/C.md', 'D.md', false, 'deep/nested/D.md')
  const result = await service.read('deep/nested/D.md')
  assert.ok(result.text.includes('[A](../../A.md)'))
  assert.ok(result.text.includes('![local](../../assets/pic.png)'))
  assert.ok(result.text.includes('![server](/api/notes/assets/test.png)'))
  const graph = await service.identity.graph()
  assert.ok(
    graph.edges.some(edge => edge.sourceId === a.id && edge.targetId === b.id)
  )
})

test('external rename with ID repairs links, absence keeps targets and reused path cannot hijack them', async t => {
  const { service, root } = await setup(t)
  const b = await service.save('B.md', '# B')
  const a = await service.save('A.md', '[B](B.md)')
  await rename(join(root, 'B.md'), join(root, 'C.md'))
  await service.index()
  assert.equal((await service.read('C.md')).id, b.id)
  assert.ok((await service.read('A.md')).text.includes('[B](C.md)'))
  await rm(join(root, 'C.md'))
  const now = Date.now()
  const clock = mock.method(Date, 'now', () => now)
  await service.index()
  clock.mock.restore()
  const later = mock.method(Date, 'now', () => now + 3000)
  await service.index()
  later.mock.restore()
  assert.equal(
    (await service.identity.descriptor(b.id!, b.storageId!)).note.presence,
    'missing'
  )
  await service.save('C.md', '# New')
  const source = await service.read('A.md')
  const resolved = await service.identity.resolve(
    a.id!,
    a.storageId!,
    source.text,
    'C.md'
  )
  assert.equal(resolved.id, b.id)
  assert.equal(splitNote(source.text).body, '[B](C.md)')
})

test('unfinished link rewrite survives conflict, retry does not overwrite external text', async t => {
  const { service, root } = await setup(t)
  await service.save('B.md', '# B')
  await service.save('A.md', '[B](B.md)')
  const original = service.repository.moveEntry.bind(service.repository)
  const move = mock.method(
    service.repository,
    'moveEntry',
    async (...args: Parameters<typeof original>) => {
      await original(...args)
      await writeFile(join(root, 'A.md'), 'External [B](B.md)')
    }
  )
  const result = await service.rename('B.md', 'C.md', false)
  move.mock.restore()
  assert.equal(result.complete, false)
  assert.equal(await readFile(join(root, 'A.md'), 'utf8'), 'External [B](B.md)')
  await service.identity.retry()
  assert.equal(await readFile(join(root, 'A.md'), 'utf8'), 'External [B](C.md)')
  assert.equal(service.identity.catalog.operations().length, 0)
})

test('duplicate YAML IDs remain separate, removing ID is harmless, and a second writer is rejected', async t => {
  const { service, root } = await setup(t)
  const a = await service.save('A.md', '# A')
  await writeFile(join(root, 'Copy.md'), a.text)
  const index = await service.index()
  const copy = index.entries.find(entry => entry.path === 'Copy.md')!
  assert.notEqual(copy.id, a.id)
  assert.ok(index.issues?.some(issue => issue.kind === 'metadata'))
  const withoutId = await service.identity.saveId(
    a.id!,
    a.storageId!,
    '# No ID',
    a.version
  )
  assert.equal(withoutId.id, a.id)
  const second = new NotesService(root, root, false, createEventBus())
  await assert.rejects(second.index(), /active writer/)
  await second.identity.close()
  await assert.rejects(
    service.identity.saveId(
      a.id!,
      a.storageId!,
      '---\ntags: invalid\n---\n',
      withoutId.version
    ),
    { statusCode: 400 }
  )
})

test('same-path return without ID needs confirmation and missing storage does not delete identities', async t => {
  const { service, root } = await setup(t)
  await writeFile(join(root, 'A.md'), 'Original')
  const a = await service.read('A.md')
  await rm(join(root, 'A.md'))
  const now = Date.now()
  const clock = mock.method(Date, 'now', () => now)
  await service.index()
  clock.mock.restore()
  const later = mock.method(Date, 'now', () => now + 3000)
  await service.index()
  later.mock.restore()
  await writeFile(join(root, 'A.md'), 'Restored externally')
  const index = await service.index()
  const candidate = index.entries.find(entry => entry.path === 'A.md')!
  assert.notEqual(candidate.id, a.id)
  const issue = index.issues!.find(
    item => item.noteId === a.id && item.candidateId === candidate.id
  )!
  assert.ok(issue)
  await service.identity.resolveIdentity(issue.id, true)
  assert.equal((await service.read('A.md')).id, a.id)
  assert.equal(
    (await service.identity.descriptor(candidate.id!, a.storageId!)).note.id,
    a.id
  )
  await rename(root, root + '-offline')
  await assert.rejects(service.index(), /unavailable/)
  assert.equal(service.identity.catalog.get(a.id!)!.presence, 'present')
  await rename(root + '-offline', root)
})

test('operation recovery after an interrupted move is idempotent and preserves identities', async t => {
  const { service, root, db } = await setup(t)
  const b = await service.save('B.md', '# B')
  await service.save('A.md', '[B](B.md)')
  const original = service.repository.moveEntry.bind(service.repository)
  const crash = mock.method(
    service.repository,
    'moveEntry',
    async (...args: Parameters<typeof original>) => {
      await original(...args)
      throw new Error('Simulated interruption after the filesystem move')
    }
  )
  await assert.rejects(
    service.rename('B.md', 'C.md', false),
    /Simulated interruption/
  )
  crash.mock.restore()
  assert.equal(service.identity.catalog.operations().length, 1)
  await service.identity.close()
  const restarted = new NotesService(root, root, false, createEventBus(), db)
  t.after(() => restarted.identity.close())
  await restarted.index()
  assert.equal((await restarted.read('C.md')).id, b.id)
  assert.ok((await restarted.read('A.md')).text.includes('[B](C.md)'))
  assert.equal(restarted.identity.catalog.operations().length, 0)
  await restarted.index()
  assert.ok((await restarted.read('A.md')).text.includes('[B](C.md)'))
})

test('initial import indexes links without rewriting files or retaining document bodies', async t => {
  const { service, root } = await setup(t)
  await writeFile(join(root, 'A.md'), '[B](B.md)')
  await writeFile(join(root, 'B.md'), '# B')
  const index = await service.index()
  const a = index.entries.find(note => note.path === 'A.md')!
  const b = index.entries.find(note => note.path === 'B.md')!
  assert.ok(
    (await service.identity.graph()).edges.some(
      edge => edge.sourceId === a.id && edge.targetId === b.id
    )
  )
  assert.equal(await readFile(join(root, 'A.md'), 'utf8'), '[B](B.md)')
})

test('folder moves preserve identities, internal links and incoming links as one operation', async t => {
  const { service } = await setup(t)
  const b = await service.save('folder/B.md', '[A](A.md)')
  const a = await service.save('folder/A.md', '[B](B.md) ![image](pic.png)')
  await service.save('Outside.md', '[A](folder/A.md)')
  const result = await service.rename('folder', 'Moved', true)
  assert.equal(result.complete, true)
  assert.equal((await service.read('Moved/A.md')).id, a.id)
  assert.equal((await service.read('Moved/B.md')).id, b.id)
  assert.equal(
    splitNote((await service.read('Moved/A.md')).text).body,
    '[B](B.md) ![image](pic.png)'
  )
  assert.equal(
    splitNote((await service.read('Moved/B.md')).text).body,
    '[A](A.md)'
  )
  assert.equal(
    splitNote((await service.read('Outside.md')).text).body,
    '[A](Moved/A.md)'
  )
})

test('a failed directory snapshot leaves existing presence unchanged', async t => {
  const { service, db } = await setup(t)
  const note = await service.save('folder/A.md', '# A')
  const failure = mock.method(service.repository, 'list', async () => {
    throw Object.assign(new Error('Directory disappeared during scan'), {
      code: 'ENOENT'
    })
  })
  await assert.rejects(service.index(), /Directory disappeared/)
  failure.mock.restore()
  const row = db
    .prepare('SELECT presence FROM note_catalog WHERE id = ?')
    .get(note.id!)
  assert.equal(row?.presence, 'present')
})

test('external folder rename with unique YAML IDs repairs links together', async t => {
  const { service, root } = await setup(t)
  const b = await service.save('folder/B.md', '[A](A.md)')
  const a = await service.save('folder/A.md', '[B](B.md)')
  await service.save('Outside.md', '[A](folder/A.md) [B](folder/B.md)')
  await rename(join(root, 'folder'), join(root, 'Moved'))
  await service.index()
  assert.equal((await service.read('Moved/A.md')).id, a.id)
  assert.equal((await service.read('Moved/B.md')).id, b.id)
  assert.equal(
    splitNote((await service.read('Outside.md')).text).body,
    '[A](Moved/A.md) [B](Moved/B.md)'
  )
  assert.equal(
    splitNote((await service.read('Moved/A.md')).text).body,
    '[B](B.md)'
  )
})

test('deletion renames the file with a UUID suffix, keeps its bytes and stays hidden across scans and service restart', async t => {
  const { service, root, db } = await setup(t)
  const note = await service.save(
    'folder/hidden.md',
    '---\ntags: [hidden]\n---\n# Keep me'
  )
  assert.ok(note.id)
  assert.ok(note.storageId)
  const source = await service.save('source.md', '[hidden](folder/hidden.md)')
  const bytes = await readFile(join(root, note.path))
  await service.delete(note.id, note.storageId)
  await service.delete(note.id, note.storageId)
  const deletedPath = service.identity.catalog.get(note.id)?.path ?? ''
  assert.match(deletedPath, /^folder\/hidden_deleted_[0-9a-f-]{36}\.md$/)
  assert.deepEqual(await readFile(join(root, deletedPath)), bytes)
  assert.equal(await service.identity.files.exists(note.path), false)
  for (let i = 0; i < 3; i++) {
    const index = await service.index()
    assert.ok(!index.entries.some(entry => entry.path === deletedPath))
    assert.ok(!index.issues?.some(issue => issue.noteId === note.id))
  }
  assert.equal(
    (await service.identity.descriptor(note.id, note.storageId)).note.presence,
    'deleted'
  )
  await assert.rejects(service.read(note.path), { statusCode: 404 })
  await assert.rejects(service.identity.readId(note.id, note.storageId), {
    statusCode: 404
  })
  await assert.rejects(
    service.save(note.path, 'Overwrite', note.version, note.id, note.storageId),
    { statusCode: 404 }
  )
  const replacement = await service.save(note.path, 'Replacement')
  assert.notEqual(replacement.id, note.id)
  const graph = await service.identity.graph()
  assert.ok(!graph.nodes.some(node => node.id === note.id))
  assert.ok(!graph.edges.some(edge => edge.targetId === note.id))
  assert.ok(source.id)
  const resolution = await service.identity.resolve(
    source.id,
    note.storageId,
    source.text,
    'folder/hidden.md'
  )
  assert.equal(resolution.id, note.id)
  await service.identity.close()
  const restarted = new NotesService(root, root, false, createEventBus(), db)
  t.after(() => restarted.identity.close())
  assert.ok(
    !(await restarted.index()).entries.some(entry => entry.id === note.id)
  )
  await rename(join(root, deletedPath), join(root, 'moved-hidden.md'))
  assert.ok(
    !(await restarted.index()).entries.some(
      entry => entry.path === 'moved-hidden.md'
    )
  )
  assert.equal(
    restarted.identity.catalog.get(note.id)?.deletedAt !== null,
    true
  )
})

test('soft deletion of imported Markdown without YAML does not register a new visible identity', async t => {
  const { service, root } = await setup(t)
  await writeFile(join(root, 'plain.md'), '# Plain')
  const note = await service.read('plain.md')
  assert.ok(note.id)
  assert.ok(note.storageId)
  await assert.rejects(service.delete(note.id, 'wrong-storage'), {
    statusCode: 400
  })
  await service.delete(note.id, note.storageId)
  const deletedPath = service.identity.catalog.get(note.id)?.path ?? ''
  assert.match(deletedPath, /^plain_deleted_[0-9a-f-]{36}\.md$/)
  assert.equal(await readFile(join(root, deletedPath), 'utf8'), '# Plain')
  assert.deepEqual((await service.index()).entries, [])
  await writeFile(join(root, deletedPath), '# External edit')
  assert.deepEqual((await service.index()).entries, [])
  await rm(join(root, deletedPath))
  const now = Date.now()
  const clock = mock.method(Date, 'now', () => now)
  await service.index()
  clock.mock.restore()
  const later = mock.method(Date, 'now', () => now + 3000)
  await service.index()
  later.mock.restore()
  await writeFile(join(root, deletedPath), '# Returned')
  assert.deepEqual((await service.index()).entries, [])
  assert.equal(service.identity.catalog.all().length, 1)
  assert.equal(await readFile(join(root, deletedPath), 'utf8'), '# Returned')
})

test('folder moves retain the deletion marker for hidden children and free the original name', async t => {
  const { service, root } = await setup(t)
  const hidden = await service.save('folder/hidden.md', 'Keep')
  await service.save('visible.md', 'Visible')
  assert.ok(hidden.id)
  assert.ok(hidden.storageId)
  await service.delete(hidden.id, hidden.storageId)
  await service.rename('folder', 'moved', true)
  const record = service.identity.catalog.get(hidden.id)
  assert.match(record?.path ?? '', /^moved\/hidden_deleted_[0-9a-f-]{36}\.md$/)
  assert.ok(record?.deletedAt)
  assert.ok(
    (await readFile(join(root, record?.path ?? ''), 'utf8')).includes('Keep')
  )
  assert.ok(!(await service.index()).entries.some(e => e.id === hidden.id))
  await service.rename('visible.md', 'hidden.md', false, 'moved/hidden.md')
  assert.ok((await service.read('moved/hidden.md')).text.includes('Visible'))
})

test('deleting a missing note releases its path for a new note', async t => {
  const { service, root } = await setup(t)
  const note = await service.save('a.md', '# A')
  assert.ok(note.id)
  assert.ok(note.storageId)
  await rm(join(root, 'a.md'))
  const now = Date.now()
  const first = mock.method(Date, 'now', () => now)
  await service.index()
  first.mock.restore()
  const later = mock.method(Date, 'now', () => now + 3000)
  await service.index()
  later.mock.restore()
  assert.equal(
    (await service.identity.descriptor(note.id, note.storageId)).note.presence,
    'missing'
  )
  await service.delete(note.id, note.storageId)
  assert.match(
    service.identity.catalog.get(note.id)?.path ?? '',
    /^a_deleted_[0-9a-f-]{36}\.md$/
  )
  const created = await service.save('a.md', '# New')
  assert.notEqual(created.id, note.id)
  assert.equal((await service.read('a.md')).text.includes('# New'), true)
})
