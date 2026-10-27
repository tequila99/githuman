import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSafePrefixedFilename } from '../../../src/shared/utils/is-safe-prefixed-filename.ts'

test('prefixed filenames accept document and temporary names, Unicode and an empty prefix', () => {
  for (const [name, prefix] of [
    ['ght-document.md', 'ght-'],
    ['ght-document.md.operation.tmp', 'ght-'],
    ['custom-план🧪.md', 'custom-'],
    ['document.md', ''],
    ['.document.md', '.']
  ]) {
    assert.equal(isSafePrefixedFilename(name, prefix), true, name)
  }
})

test('prefixed filenames must start with the exact namespace', () => {
  assert.equal(isSafePrefixedFilename('other-document.md', 'ght-'), false)
  assert.equal(isSafePrefixedFilename('before-ght-document.md', 'ght-'), false)
  assert.equal(isSafePrefixedFilename('GHT-document.md', 'ght-'), false)
})

test('prefixed filenames reject path separators and NUL at any position', () => {
  for (const character of ['/', '\\', '\0']) {
    for (const name of [
      `${character}document.md`,
      `doc${character}ument.md`,
      `document.md${character}`
    ]) {
      assert.equal(
        isSafePrefixedFilename(name, ''),
        false,
        JSON.stringify(name)
      )
      assert.equal(
        isSafePrefixedFilename(`ght-${name}`, 'ght-'),
        false,
        JSON.stringify(name)
      )
    }
  }
  assert.equal(isSafePrefixedFilename('../document.md', ''), false)
  assert.equal(isSafePrefixedFilename('..\\document.md', ''), false)
})

test('empty names and directory aliases are rejected even with an empty prefix', () => {
  for (const name of ['', '.', '..']) {
    assert.equal(isSafePrefixedFilename(name, ''), false)
    assert.equal(isSafePrefixedFilename(name, name), false)
  }
})
