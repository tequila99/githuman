import { test, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useNotesStore } from '@/stores/notes-store'
import { notesApi } from '@/api/notes'
import { ApiRequestError } from '@/api/client'

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => mock.restoreAll())
const note = { path: 'a.md', text: 'original', version: 'v1' }

test('late save response keeps new input and queues a second versioned write', async () => {
  mock.method(notesApi, 'read', async () => note)
  const store = useNotesStore()
  await store.select('a.md')
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const writes: string[][] = []
  mock.method(
    notesApi,
    'save',
    async (path: string, text: string, version: string) => {
      writes.push([text, version])
      if (writes.length === 1) await gate
      return { path, text, version: 'v' + (writes.length + 1) }
    }
  )
  store.edit('a.md', 'first')
  const save = store.save()
  store.edit('a.md', 'second')
  release()
  assert.equal(await save, true)
  assert.deepEqual(writes, [
    ['first', 'v1'],
    ['second', 'v2']
  ])
  assert.equal(store.current?.text, 'second')
  assert.equal(store.current?.status, 'saved')
})
test('conflict blocks switching and retains draft and disk versions', async () => {
  mock.method(notesApi, 'read', async () => note)
  const store = useNotesStore()
  await store.select('a.md')
  store.edit('a.md', 'my draft')
  mock.method(notesApi, 'save', async () => {
    throw new ApiRequestError('Conflict', 409)
  })
  mock.method(notesApi, 'read', async () => ({
    ...note,
    text: 'external',
    version: 'v2'
  }))
  assert.equal(await store.select('b.md'), false)
  assert.equal(store.selected, 'a.md')
  assert.equal(store.current?.text, 'my draft')
  assert.equal(store.current?.disk?.text, 'external')
  assert.equal(store.current?.status, 'conflict')
})
test('opening without edits never writes and invalid YAML keeps draft', async () => {
  mock.method(notesApi, 'read', async () => note)
  const save = mock.method(notesApi, 'save', async () => note)
  const store = useNotesStore()
  await store.select('a.md')
  assert.equal(await store.save(), true)
  assert.equal(save.mock.callCount(), 0)
  store.edit('a.md', '---\ntags: invalid\n---\n')
  assert.equal(await store.save(), false)
  assert.equal(save.mock.callCount(), 0)
  assert.equal(store.current?.status, 'error')
})
test('external updates reload clean notes but retain dirty notes', async () => {
  mock.method(notesApi, 'read', async () => note)
  mock.method(notesApi, 'index', async () => ({
    entries: [],
    storage: '/notes',
    warning: null
  }))
  const store = useNotesStore()
  await store.select('a.md')
  mock.method(notesApi, 'read', async () => ({
    ...note,
    text: 'external',
    version: 'v2'
  }))
  await store.refresh()
  assert.equal(store.current?.text, 'external')
  store.edit('a.md', 'draft')
  mock.method(notesApi, 'read', async () => ({
    ...note,
    text: 'external again',
    version: 'v3'
  }))
  await store.refresh()
  assert.equal(store.current?.text, 'draft')
  assert.equal(store.current?.status, 'conflict')
})

test('stale refresh response cannot report a conflict after a newer save', async () => {
  mock.method(notesApi, 'read', async () => note)
  mock.method(notesApi, 'index', async () => ({
    entries: [],
    storage: '/notes',
    warning: null
  }))
  const store = useNotesStore()
  await store.select('a.md')
  let resolveRead!: (value: typeof note) => void
  let started!: () => void
  const reading = new Promise<void>(resolve => {
    started = resolve
  })
  mock.method(notesApi, 'read', () => {
    started()
    return new Promise<typeof note>(resolve => {
      resolveRead = resolve
    })
  })
  const refresh = store.refresh()
  await reading
  mock.method(notesApi, 'save', async (path: string, text: string) => ({
    path,
    text,
    version: 'v2'
  }))
  store.edit('a.md', 'new content')
  await store.save()
  resolveRead(note)
  await refresh
  assert.equal(store.current?.text, 'new content')
  assert.equal(store.current?.version, 'v2')
  assert.equal(store.current?.status, 'saved')
})

test('rename saves nested drafts and remaps the selected note', async () => {
  mock.method(notesApi, 'read', async (path: string) => ({ ...note, path }))
  mock.method(notesApi, 'index', async () => ({
    entries: [],
    storage: '',
    warning: null
  }))
  const store = useNotesStore()
  await store.select('folder/a.md')
  store.edit('folder/a.md', 'edited')
  const calls: string[] = []
  mock.method(notesApi, 'save', async (path: string, text: string) => {
    calls.push('save')
    return { path, text, version: 'v2' }
  })
  mock.method(notesApi, 'rename', async () => {
    calls.push('rename')
  })
  mock.method(notesApi, 'read', async (path: string) => ({
    path,
    text: 'edited',
    version: 'v2'
  }))
  assert.equal(await store.rename('folder', 'new', true), true)
  assert.deepEqual(calls, ['save', 'rename'])
  assert.equal(store.selected, 'new/a.md')
  assert.equal(store.current?.text, 'edited')
  assert.equal(store.drafts['folder/a.md'], undefined)
})

test('failed rename retains the selected path and draft', async () => {
  mock.method(notesApi, 'read', async () => note)
  mock.method(notesApi, 'rename', async () => {
    throw new ApiRequestError('Occupied', 409)
  })
  const store = useNotesStore()
  await store.select('a.md')
  assert.equal(await store.rename('a.md', 'b.md', false), false)
  assert.equal(store.selected, 'a.md')
  assert.equal(store.current?.text, 'original')
  assert.equal(store.error, 'Occupied')
})

test('refresh preserves navigation identity while still loading changed note content and storage warnings', async () => {
  let text = 'original'
  let warning: string | null = null
  mock.method(notesApi, 'read', async () => ({ ...note, text, version: text }))
  mock.method(notesApi, 'index', async () => ({
    entries: [{ path: 'a.md', folder: false, tags: ['one'], error: null }],
    storage: '/notes',
    warning
  }))
  const store = useNotesStore()
  await store.select('a.md')
  await store.refresh()
  const index = store.index
  const entries = store.index.entries
  const entry = entries[0]
  text = 'external'
  await store.refresh()
  assert.equal(store.index, index)
  assert.equal(store.index.entries, entries)
  assert.equal(store.current?.text, 'external')
  warning = 'Visibility changed'
  await store.refresh()
  assert.notEqual(store.index, index)
  assert.equal(store.index.entries, entries)
  assert.equal(store.index.entries[0], entry)
  assert.equal(store.index.warning, warning)
})

test('UUID drafts survive path changes and saves address the identity rather than a stale path', async () => {
  const identity = {
    id: '00000000-0000-4000-8000-000000000001',
    storageId: '00000000-0000-4000-8000-000000000002'
  }
  let path = 'a.md'
  mock.method(notesApi, 'read', async () => ({ ...note, ...identity, path }))
  mock.method(notesApi, 'readId', async () => ({ ...note, ...identity, path }))
  mock.method(notesApi, 'index', async () => ({
    entries: [{ path, id: identity.id, folder: false, tags: [], error: null }],
    storage: '/notes',
    storageId: identity.storageId,
    warning: null
  }))
  const store = useNotesStore()
  await store.select('a.md')
  path = 'new/a.md'
  await store.refresh()
  assert.equal(store.selectedId, identity.id)
  assert.equal(store.selected, path)
  store.edit(identity.id, 'edited')
  const saved = mock.method(notesApi, 'save', async () => ({
    ...note,
    ...identity,
    path,
    text: 'edited',
    version: 'v2'
  }))
  await store.save()
  assert.deepEqual(saved.mock.calls[0]?.arguments, [
    path,
    'edited',
    'v1',
    identity.id,
    identity.storageId
  ])
  assert.equal(store.current?.text, 'edited')
})

test('soft deletion saves the draft, sends its stable identity and removes it from local state', async () => {
  const identified = { ...note, id: 'note-id', storageId: 'storage' }
  mock.method(notesApi, 'read', async () => identified)
  const store = useNotesStore()
  await store.select('a.md')
  store.index = {
    entries: [
      { path: 'a.md', id: 'note-id', folder: false, tags: [], error: null }
    ],
    storage: '/notes',
    storageId: 'storage',
    warning: null
  }
  store.edit('a.md', 'latest')
  const saved = mock.method(notesApi, 'save', async () => ({
    ...identified,
    text: 'latest',
    version: 'v2'
  }))
  const removed = mock.method(notesApi, 'delete', async () => {
    assert.equal(saved.mock.callCount(), 1)
    assert.equal(store.current?.saved, 'latest')
  })
  mock.method(notesApi, 'index', async () => ({
    entries: [],
    storage: '/notes',
    storageId: 'storage',
    warning: null
  }))
  assert.equal(await store.remove('a.md'), true)
  assert.deepEqual(removed.mock.calls[0]?.arguments, ['note-id', 'storage'])
  assert.equal(store.current, undefined)
  assert.equal(store.selectedId, '')
  assert.deepEqual(store.drafts, {})
})

test('a failed deletion retains the draft and exposes the error', async () => {
  mock.method(notesApi, 'read', async () => ({
    ...note,
    id: 'note-id',
    storageId: 'storage'
  }))
  const store = useNotesStore()
  await store.select('a.md')
  store.index = {
    entries: [
      { path: 'a.md', id: 'note-id', folder: false, tags: [], error: null }
    ],
    storage: '/notes',
    storageId: 'storage',
    warning: null
  }
  mock.method(notesApi, 'delete', async () => {
    throw new Error('Unavailable')
  })
  assert.equal(await store.remove('a.md'), false)
  assert.equal(store.current?.text, note.text)
  assert.equal(store.error, 'Unavailable')
})

test('deletion in another tab retains an unsaved draft without trapping navigation or writing it back', async () => {
  const identified = { ...note, id: 'note-id', storageId: 'storage' }
  const deleted = {
    id: 'note-id',
    path: 'a.md',
    presence: 'deleted' as const,
    version: 'v1',
    createdAt: '',
    updatedAt: ''
  }
  mock.method(notesApi, 'readId', async () => identified)
  const descriptor = mock.method(notesApi, 'descriptor', async () => ({
    note: { ...deleted, presence: 'present' },
    backlinks: []
  }))
  const store = useNotesStore()
  await store.selectId('note-id', 'storage')
  store.edit('a.md', 'Unsaved draft')
  mock.method(notesApi, 'index', async () => ({
    entries: [],
    storage: '/notes',
    storageId: 'storage',
    warning: null
  }))
  mock.method(notesApi, 'readId', async () => {
    throw new ApiRequestError('Deleted', 404)
  })
  descriptor.mock.restore()
  mock.method(notesApi, 'descriptor', async () => ({
    note: deleted,
    backlinks: []
  }))
  const save = mock.method(notesApi, 'save', async () => identified)
  await store.refresh()
  assert.equal(store.descriptor?.note.presence, 'deleted')
  assert.equal(store.current?.text, 'Unsaved draft')
  assert.equal(await store.save(), true)
  assert.equal(save.mock.callCount(), 0)
  store.clearSelection()
  assert.equal(await store.save('note-id'), true)
  assert.equal(save.mock.callCount(), 0)
})

test('drag move refuses a different identity at the original path after refresh', async () => {
  const store = useNotesStore()
  mock.method(notesApi, 'index', async () => ({
    entries: [
      { path: 'a.md', id: 'replacement', folder: false, tags: [], error: null }
    ],
    storage: '/notes',
    storageId: 'storage',
    warning: null
  }))
  const rename = mock.method(notesApi, 'rename', async () => ({
    operationId: 'operation',
    complete: true
  }))
  assert.equal(
    await store.rename('a.md', 'a.md', false, 'folder/a.md', 'original'),
    false
  )
  assert.equal(rename.mock.callCount(), 0)
  assert.match(store.error, /moved or changed/)
})
