import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcileNoteEntries } from '@/utils/notes/reconcile-entries'
import type { NoteEntry } from '../../../../src/shared/notes/types.ts'

test('reconciliation preserves unchanged records and detects every navigation field', () => {
  const previous: NoteEntry[] = [
    { path: 'a.md', folder: false, tags: ['one'], error: null },
    { path: 'b.md', folder: false, tags: [], error: null }
  ]
  assert.equal(
    reconcileNoteEntries(previous, structuredClone(previous)),
    previous
  )
  for (const patch of [
    { path: 'renamed.md' },
    { folder: true },
    { tags: ['two'] },
    { error: 'Invalid YAML' }
  ]) {
    const next = structuredClone(previous)
    Object.assign(next[0]!, patch)
    const result = reconcileNoteEntries(previous, next)
    assert.notEqual(result, previous)
    assert.deepEqual(result[0], next[0])
    assert.equal(result[1], previous[1])
  }
  assert.deepEqual(reconcileNoteEntries(previous, []), [])
  const reordered = reconcileNoteEntries(
    previous,
    structuredClone(previous).toReversed()
  )
  assert.equal(reordered[0], previous[1])
  assert.equal(reordered[1], previous[0])
  const added = reconcileNoteEntries(previous, [
    ...structuredClone(previous),
    { path: 'new', folder: true, tags: [], error: null }
  ])
  assert.equal(added[0], previous[0])
  assert.equal(added.length, 3)
})
