import assert from 'node:assert/strict'
import { test } from 'node:test'
import { safeFileName } from '../../../src/server/utils/file-name.ts'

test('a plain name is kept', () => {
  assert.equal(safeFileName('report.pdf'), 'report.pdf')
  assert.equal(safeFileName('my notes (1).txt'), 'my notes (1).txt')
})

test('directories in the name are dropped, with either separator', () => {
  assert.equal(safeFileName('a/b/c.txt'), 'c.txt')
  assert.equal(safeFileName('..\\..\\x.txt'), 'x.txt')
  assert.equal(safeFileName('../../etc/passwd'), 'passwd')
  assert.equal(safeFileName('/abs/path.txt'), 'path.txt')
})

test('NUL bytes are removed', () => {
  assert.equal(safeFileName('a\0b.txt'), 'ab.txt')
})

test('names with nothing usable become "attachment"', () => {
  for (const name of ['', '.', '..', '/', '\\', '../', 'a/..', '\0']) {
    assert.equal(safeFileName(name), 'attachment', JSON.stringify(name))
  }
})
