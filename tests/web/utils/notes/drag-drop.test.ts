import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseNoteDrag, noteDropTarget } from '@/utils/notes/drag-drop'
import type { NoteEntry } from '../../../../src/shared/notes/types.ts'

const entries: NoteEntry[] = [
  { path: 'a', folder: true, tags: [], error: null },
  { path: 'b', folder: true, tags: [], error: null },
  { id: 'note', path: 'a/My note.md', folder: false, tags: [], error: null }
]
const payload = { noteId: 'note', storageId: 'storage' }

test('note drops resolve current identity and preserve the name for folders and root', () => {
  assert.deepEqual(noteDropTarget(payload, 'storage', entries, 'b'), {
    path: 'a/My note.md',
    target: 'b/My note.md'
  })
  assert.deepEqual(noteDropTarget(payload, 'storage', entries, ''), {
    path: 'a/My note.md',
    target: 'My note.md'
  })
  assert.equal(noteDropTarget(payload, 'storage', entries, 'a'), null)
  assert.equal(noteDropTarget(payload, 'other', entries, 'b'), null)
  assert.equal(noteDropTarget(payload, 'storage', entries, 'missing'), null)
  assert.equal(
    noteDropTarget({ ...payload, noteId: 'missing' }, 'storage', entries, 'b'),
    null
  )
})

test('only well-formed note payloads can be dropped', () => {
  assert.deepEqual(parseNoteDrag(JSON.stringify(payload)), payload)
  for (const value of [
    'not json',
    '{}',
    'null',
    '1',
    '[]',
    '{"noteId":"id","storageId":1}',
    '{"noteId":"","storageId":"s"}'
  ]) {
    assert.equal(parseNoteDrag(value), null)
  }
})
