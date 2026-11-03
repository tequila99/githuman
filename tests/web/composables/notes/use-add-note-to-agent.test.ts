import { beforeEach, afterEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { notesApi } from '@/api/notes'
import { useNotesStore } from '@/stores/notes-store'
import { useNoteAgentContext } from '@/composables/notes/use-add-note-to-agent'

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => mock.restoreAll())

test('note context is resolved only after saving and uses the persisted identity', async () => {
  const calls: string[] = []
  mock.method(useNotesStore(), 'save', async (path: string) => {
    calls.push('save:' + path)
    return true
  })
  mock.method(notesApi, 'read', async (path: string) => {
    calls.push('read:' + path)
    return {
      id: 'note-id',
      storageId: 'storage-id',
      path: 'folder/saved.md',
      text: '',
      version: 'v1'
    }
  })
  const context = await useNoteAgentContext()('folder/draft.md')
  assert.deepEqual(calls, ['save:folder/draft.md', 'read:folder/draft.md'])
  assert.deepEqual(context, {
    kind: 'note',
    noteId: 'note-id',
    storageId: 'storage-id',
    name: 'saved.md'
  })
})

test('a failed save prevents reading or adding an outdated note', async () => {
  mock.method(useNotesStore(), 'save', async () => false)
  const read = mock.method(notesApi, 'read')
  await assert.rejects(useNoteAgentContext()('draft.md'), /Could not save/)
  assert.equal(read.mock.callCount(), 0)
})

test('missing persistent identity cannot become note context', async () => {
  mock.method(useNotesStore(), 'save', async () => true)
  mock.method(notesApi, 'read', async () => ({
    path: 'note.md',
    text: '',
    version: 'v1'
  }))
  await assert.rejects(
    useNoteAgentContext()('note.md'),
    /identity is unavailable/
  )
})
