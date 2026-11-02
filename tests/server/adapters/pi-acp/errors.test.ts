import assert from 'node:assert/strict'
import { test } from 'node:test'
import { piFailureReason } from '../../../../src/server/adapters/pi-acp/errors.ts'

test('pi failures expose actionable categories without raw credentials or provider output', () => {
  for (const [input, expected] of [
    ['No API key found for provider secret-value', /authorization/],
    ['401 secret-value', /authorization/],
    ['No model selected: secret-value', /configured model/],
    ['ECONNREFUSED secret-value', /connection/],
    ['429 quota exceeded: secret-value', /limit/],
    ['Unexpected secret-value', /request failed/]
  ] as const) {
    const message = piFailureReason(input)
    assert.match(message, expected)
    assert.ok(!message.includes('secret-value'))
  }
})
