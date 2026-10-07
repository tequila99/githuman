import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Value } from '@sinclair/typebox/value'
import { TerminalClientMessageSchema } from '../../../src/shared/terminal/schemas.ts'

test('terminal protocol accepts input and rejects shell configuration and dimensions', () => {
  assert.ok(
    Value.Check(TerminalClientMessageSchema, {
      type: 'input',
      terminalId: 'session',
      data: 'git status\r'
    })
  )
  for (const message of [
    { type: 'create', requestId: '1', cols: 80, rows: 24, command: 'bash' },
    { type: 'resize', terminalId: 'session', cols: 301, rows: 24 },
    { type: 'create', requestId: '1', cols: 0, rows: 24 },
    { type: 'input', terminalId: 'session', data: 'x'.repeat(65537) }
  ])
    assert.equal(Value.Check(TerminalClientMessageSchema, message), false)
})
