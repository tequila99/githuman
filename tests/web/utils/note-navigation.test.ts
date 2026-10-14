import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noteFolderChildren } from '../../../src/web/utils/note-navigation.ts'
import type { NoteEntry } from '../../../src/shared/notes/types.ts'

function entry(path: string, folder = false): NoteEntry {
  return { path, folder, tags: [], error: null }
}

test('folder navigation lists direct children, with folders first and note labels sorted', () => {
  const entries = [
    entry('selected/z.md'),
    entry('selected/a.md'),
    entry('selected/nested/deep.md'),
    entry('selected/empty', true),
    entry('selected/nested', true),
    entry('selected-other/hidden.md'),
    entry('outside.md')
  ]
  assert.deepEqual(noteFolderChildren(entries, 'selected'), [
    { path: 'selected/empty', label: 'empty', folder: true },
    { path: 'selected/nested', label: 'nested', folder: true },
    { path: 'selected/a.md', label: 'a', folder: false },
    { path: 'selected/z.md', label: 'z', folder: false }
  ])
  assert.deepEqual(noteFolderChildren(entries, 'selected/empty'), [])
  assert.deepEqual(
    noteFolderChildren(entries, '').map(item => item.path),
    ['selected', 'selected-other', 'outside.md']
  )
})

test('tag filtering supports all, any, and an empty selection', async () => {
  const { matchesNoteTags } =
    await import('../../../src/web/utils/note-navigation.ts')
  assert.equal(matchesNoteTags([], [], 'all'), true)
  assert.equal(matchesNoteTags([], [], 'any'), true)
  assert.equal(matchesNoteTags(['a', 'b'], ['a', 'b'], 'all'), true)
  assert.equal(matchesNoteTags(['a'], ['a', 'b'], 'all'), false)
  assert.equal(matchesNoteTags(['a'], ['a', 'b'], 'any'), true)
  assert.equal(matchesNoteTags(['c'], ['a', 'b'], 'any'), false)
  assert.equal(matchesNoteTags(['A'], ['a'], 'any'), false)
})
