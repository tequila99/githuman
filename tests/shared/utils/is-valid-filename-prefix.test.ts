import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isValidFilenamePrefix } from '../../../src/shared/utils/is-valid-filename-prefix.ts'

test('filename prefixes allow empty, ASCII and Unicode values', () => {
  for (const prefix of [
    '',
    'ght-',
    'custom_',
    'заметки-',
    '文档-',
    '🧪-',
    'my prefix-',
    '.',
    '..',
    'CON-'
  ]) {
    assert.equal(isValidFilenamePrefix(prefix), true, JSON.stringify(prefix))
  }
})

test('filename prefix length is limited to 100 UTF-16 code units', () => {
  assert.equal(isValidFilenamePrefix('a'.repeat(100)), true)
  assert.equal(isValidFilenamePrefix('a'.repeat(101)), false)
  assert.equal(isValidFilenamePrefix('🧪'.repeat(50)), true)
  assert.equal(isValidFilenamePrefix('🧪'.repeat(51)), false)
})

test('filename prefixes reject separators and forbidden filename characters', () => {
  for (const character of ['<', '>', ':', '"', '/', '\\', '|', '?', '*']) {
    for (const prefix of [
      character,
      `${character}ght`,
      `ght${character}`,
      `gh${character}t`
    ]) {
      assert.equal(isValidFilenamePrefix(prefix), false, JSON.stringify(prefix))
    }
  }
  assert.equal(isValidFilenamePrefix('../'), false)
  assert.equal(isValidFilenamePrefix('..\\'), false)
})

test('filename prefixes reject every ASCII control character', () => {
  for (let code = 0; code < 32; code++) {
    const character = String.fromCharCode(code)
    assert.equal(isValidFilenamePrefix(character), false, `code ${code}`)
    assert.equal(
      isValidFilenamePrefix(`ght${character}-`),
      false,
      `embedded code ${code}`
    )
  }
})
