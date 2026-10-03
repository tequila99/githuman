import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  decodeText,
  isBinaryBuffer,
  truncateText
} from '../../../src/server/utils/text.ts'

test('text up to the limit is returned as it is', () => {
  assert.equal(truncateText('abcde', 5), 'abcde')
  assert.equal(truncateText('', 5), '')
})

test('longer text is cut at the limit and ends with the default marker', () => {
  assert.equal(truncateText('abcdef', 5), 'abcde\n… (truncated)')
})

test('the marker receives the number of characters dropped', () => {
  assert.equal(
    truncateText(
      'abcdefgh',
      5,
      omitted => `\n… [truncated by githuman: ${omitted} more characters]`
    ),
    'abcde\n… [truncated by githuman: 3 more characters]'
  )
  const seen: number[] = []
  truncateText('abcd', 4, n => {
    seen.push(n)
    return ''
  })
  assert.deepEqual(seen, [], 'a text that fits never asks for a marker')
})

test('a NUL byte makes a buffer binary', () => {
  assert.equal(isBinaryBuffer(Buffer.from('plain text')), false)
  assert.equal(isBinaryBuffer(Buffer.from([0x61, 0, 0x62])), true)
  assert.equal(isBinaryBuffer(new Uint8Array([0])), true)
  assert.equal(isBinaryBuffer(new Uint8Array()), false)
})

test('valid UTF-8 is decoded; NUL and broken bytes give null', () => {
  assert.equal(decodeText(Buffer.from('héllo — мир')), 'héllo — мир')
  assert.equal(decodeText(Buffer.from('a\0b')), null)
  assert.equal(decodeText(Buffer.from([0xff, 0xfe, 0x41])), null)
  assert.equal(decodeText(new Uint8Array()), '')
})

test('unlike Buffer#toString, invalid UTF-8 is refused instead of patched with U+FFFD', () => {
  const broken = Buffer.from([0x61, 0xc3, 0x28])
  assert.ok(broken.toString('utf-8').includes('�'))
  assert.equal(decodeText(broken), null)
})
