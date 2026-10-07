import { test } from 'node:test'
import assert from 'node:assert/strict'
import { editTerminalLine } from '@/utils/terminal-line-editor'

test('pipe editing preserves Unicode and handles CRLF paste without double submit', () => {
  assert.deepEqual(editTerminalLine('😀', '\x7fПривет\r\necho ready\n'), {
    draft: '',
    lines: ['Привет', 'echo ready']
  })
})
test('Ctrl+C clears a draft while Ctrl+D closes only an empty draft', () => {
  assert.deepEqual(editTerminalLine('unfinished', '\x03'), {
    draft: '',
    lines: [],
    signal: 'interrupt'
  })
  assert.deepEqual(editTerminalLine('unfinished', '\x04'), {
    draft: 'unfinished',
    lines: []
  })
  assert.deepEqual(editTerminalLine('', '\x04'), {
    draft: '',
    lines: [],
    signal: 'eof'
  })
})
test('escape sequences are dropped and do not enter the draft', () => {
  assert.deepEqual(editTerminalLine('ls', '\x1b[A\x1b[1;5C\x1bOH -la'), {
    draft: 'ls -la',
    lines: []
  })
})
