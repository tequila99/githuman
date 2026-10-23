import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  isFocusReport,
  terminalKeyInput,
  terminalControlInput
} from '@/utils/terminal-keys'

test('keypad uses xterm public cursor mode and emits each key once', async () => {
  const { Terminal } = createRequire(import.meta.url)(
    '@xterm/headless'
  ) as typeof import('@xterm/headless')
  const terminal = new Terminal({ allowProposedApi: true })
  const sent: string[] = []
  terminal.onData(data => sent.push(data))
  try {
    terminal.input(
      terminalKeyInput('up', terminal.modes.applicationCursorKeysMode),
      true
    )
    await new Promise<void>(resolve => terminal.write('\u001b[?1h', resolve))
    terminal.input(
      terminalKeyInput('up', terminal.modes.applicationCursorKeysMode),
      true
    )
    terminal.input(
      terminalKeyInput('left', terminal.modes.applicationCursorKeysMode),
      true
    )
    terminal.input(terminalKeyInput('escape', false), true)
    terminal.input(terminalKeyInput('tab', false), true)
    assert.deepEqual(sent, ['\u001b[A', '\u001bOA', '\u001bOD', '\u001b', '\t'])
  } finally {
    terminal.dispose()
  }
})

test('one-shot Ctrl converts ASCII control combinations without corrupting IME', () => {
  assert.equal(terminalControlInput('c'), '\u0003')
  assert.equal(terminalControlInput('D'), '\u0004')
  assert.equal(terminalControlInput('['), '\u001b')
  assert.equal(terminalControlInput(' '), '\0')
  for (const input of ['ж', 'ß', 'ı', 'あ', '中文', '😀', '\u001b[A']) {
    assert.equal(terminalControlInput(input), input)
  }
})

test('focus reports are told apart from user input and from one-shot Ctrl', () => {
  assert.equal(isFocusReport('\u001b[I'), true)
  assert.equal(isFocusReport('\u001b[O'), true)
  // Arrow keys share the CSI prefix but are user input.
  assert.equal(isFocusReport('\u001b[A'), false)
  assert.equal(isFocusReport('I'), false)
  assert.equal(isFocusReport('\u001b[O\u001b[I'), false)
  // A focus report keeps its bytes even if a caller sends it through the Ctrl conversion.
  assert.equal(terminalControlInput('\u001b[O'), '\u001b[O')
})
