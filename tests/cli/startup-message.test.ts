import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatStartupMessage } from '../../src/cli/startup-message.ts'

test('localhost host produces only the listening line, no LAN warning', () => {
  const lines = formatStartupMessage('http://127.0.0.1:3847', 'localhost')

  assert.deepEqual(lines, ['githuman-vue listening on http://127.0.0.1:3847'])
})

test('a non-localhost host adds a LAN-exposure warning', () => {
  const lines = formatStartupMessage('http://0.0.0.0:3847', '0.0.0.0')

  assert.deepEqual(lines, [
    'githuman-vue listening on http://0.0.0.0:3847',
    'Warning: server is reachable from your local network without authentication.'
  ])
})

test('127.0.0.1 is treated the same as localhost (no warning)', () => {
  const lines = formatStartupMessage('http://127.0.0.1:3847', '127.0.0.1')

  assert.deepEqual(lines, ['githuman-vue listening on http://127.0.0.1:3847'])
})
