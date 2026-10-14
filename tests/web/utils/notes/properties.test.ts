import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  notePropertyType,
  notePropertyLink,
  notePropertyDisplay
} from '@/utils/notes/properties'

test('types YAML properties without converting arbitrary strings or nested values', () => {
  for (const [value, type] of [
    ['2026-03-24', 'date'],
    ['2026-02-30', 'text'],
    [123, 'number'],
    [true, 'boolean'],
    [null, 'text'],
    [['one'], 'list'],
    [[1], 'complex'],
    [{ x: 1 }, 'complex']
  ] as const) {
    assert.equal(notePropertyType({ key: 'custom', value }), type)
  }
  assert.equal(notePropertyType({ key: 'tags', value: ['cat'] }), 'tags')
  assert.equal(notePropertyDisplay('2026-03-24', 'date', 'ru-RU'), '24.03.2026')
  assert.equal(notePropertyDisplay(false, 'boolean', 'en'), 'false')
})

test('property links preserve external URLs and resolve wiki names against note paths', () => {
  const paths = ['folder/Writer.md', 'Other.md']
  assert.deepEqual(
    notePropertyLink('https://example.com/a', 'folder/note.md', paths),
    {
      href: 'https://example.com/a',
      label: 'https://example.com/a',
      external: true
    }
  )
  assert.deepEqual(
    notePropertyLink('[[Writer|Author]]', 'folder/note.md', paths),
    { href: 'Writer.md', label: 'Author', external: false }
  )
  assert.deepEqual(
    notePropertyLink('[[Other#intro]]', 'folder/note.md', paths),
    { href: '../Other.md#intro', label: 'Other', external: false }
  )
  assert.equal(notePropertyLink('javascript:alert(1)', 'note.md', paths), null)
  assert.equal(notePropertyLink('plain text', 'note.md', paths), null)
})

test('ambiguous wiki basenames do not silently select the first note', () => {
  assert.equal(
    notePropertyLink('[[Same]]', 'root/note.md', ['a/Same.md', 'b/Same.md']),
    null
  )
  assert.equal(
    notePropertyLink('[[a/Same]]', 'root/note.md', ['a/Same.md', 'b/Same.md'])
      ?.href,
    '../a/Same.md'
  )
})
