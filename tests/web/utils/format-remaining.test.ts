import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatRemaining } from '@/utils/format-remaining'

test('formatRemaining shows minutes and seconds, rounded up', () => {
  assert.equal(formatRemaining(120_000), '2:00')
  assert.equal(formatRemaining(83_000), '1:23')
  assert.equal(formatRemaining(500), '0:01')
  assert.equal(formatRemaining(0), '0:00')
  assert.equal(formatRemaining(-5000), '0:00')
})
