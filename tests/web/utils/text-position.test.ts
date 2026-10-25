import { test } from 'node:test'
import assert from 'node:assert/strict'
import { locateLine } from '@/utils/text-position'

test('locateLine splits the text around the requested position', () => {
  assert.deepEqual(locateLine('ab\ncde\nf', 2, 2), {
    before: 'ab\n',
    leading: 'c',
    character: 'd',
    trailing: 'e',
    after: '\nf'
  })
})

test('locateLine uses column 1 by default and clamps a long column', () => {
  assert.equal(locateLine('ab\ncd', 2)?.character, 'c')
  const clamped = locateLine('ab\ncd', 1, 99)
  assert.equal(clamped?.leading, 'ab')
  assert.equal(clamped?.character, '')
  assert.equal(clamped?.after, '\ncd')
})

test('locateLine handles the last line without a newline and CRLF', () => {
  assert.equal(locateLine('a\nb', 2)?.character, 'b')
  assert.equal(locateLine('a\r\nb\r\n', 2)?.before, 'a\r\n')
})

test('locateLine returns null outside the text', () => {
  assert.equal(locateLine('a\nb', 3), null)
  assert.equal(locateLine('a', 0), null)
  assert.equal(locateLine('a', undefined), null)
  assert.equal(locateLine('a', 1.5), null)
})
