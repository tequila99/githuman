import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EscapeTail } from '../../../../src/server/services/terminal/escape-tail.ts'

function tailOf(data: string): string {
  const tail = new EscapeTail()
  tail.push(data)
  return tail.tail
}

test('an unfinished 7-bit control sequence stays in the tail', () => {
  assert.equal(tailOf('text\x1b[31'), '\x1b[31')
})

test('a finished control sequence leaves no tail', () => {
  assert.equal(tailOf('\x1b[31mred'), '')
})

test('every 8-bit string introducer opens a string until ST', () => {
  for (const start of ['\u009d', '\u0090', '\u0098', '\u009e', '\u009f']) {
    assert.equal(tailOf(`${start}data`), `${start}data`)
    assert.equal(tailOf(`${start}data\u009c`), '')
  }
})

test('7-bit SOS opens a string that ESC \\ ends', () => {
  assert.equal(tailOf('\x1bXdata'), '\x1bXdata')
  assert.equal(tailOf('\x1bXdata\x1b\\'), '')
})

test('a control string longer than the snapshot limit drops the tail', () => {
  const tail = new EscapeTail()
  tail.push(`\x1b]${'a'.repeat(9000)}`)
  assert.equal(tail.tail, '')
  tail.push('\x1b[31')
  assert.equal(tail.tail, '\x1b[31')
})
