import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  noteBasename,
  noteChildPath,
  noteParentPath,
  noteTitle
} from '../../../src/shared/notes/note-path.ts'

test('basename and parent split the last segment', () => {
  assert.equal(noteBasename('a/b/c.md'), 'c.md')
  assert.equal(noteParentPath('a/b/c.md'), 'a/b')
  assert.equal(noteBasename('c.md'), 'c.md')
  assert.equal(noteParentPath('c.md'), '')
  assert.equal(noteBasename(''), '')
})

test('child paths treat an empty folder as the root', () => {
  assert.equal(noteChildPath('', 'x.md'), 'x.md')
  assert.equal(noteChildPath('a/b', 'x.md'), 'a/b/x.md')
})

test('the title drops only a trailing Markdown extension', () => {
  assert.equal(noteTitle('a/Note.MD'), 'Note')
  assert.equal(noteTitle('a/Note.md.txt'), 'Note.md.txt')
})
