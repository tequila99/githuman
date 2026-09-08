import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseServeArgs } from '../../src/cli/config.ts'

test('parseServeArgs returns defaults when no flags given', () => {
  const options = parseServeArgs([])

  assert.deepEqual(options, {
    port: 3847,
    host: 'localhost',
    open: true
  })
})

test('parseServeArgs reads --port and --host', () => {
  const options = parseServeArgs(['--port', '4000', '--host', '0.0.0.0'])

  assert.equal(options.port, 4000)
  assert.equal(options.host, '0.0.0.0')
})

test('parseServeArgs reads --no-open', () => {
  const options = parseServeArgs(['--no-open'])

  assert.equal(options.open, false)
})

test('parseServeArgs accepts port 0 (OS assigns a free port)', () => {
  const options = parseServeArgs(['--port', '0'])

  assert.equal(options.port, 0)
})

test('parseServeArgs throws on non-numeric port', () => {
  assert.throws(() => parseServeArgs(['--port', 'abc']), /port/i)
})

test('parseServeArgs throws on out-of-range port', () => {
  assert.throws(() => parseServeArgs(['--port', '70000']), /port/i)
})
