import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseServeArgs,
  resolveDbPrefix,
  DEFAULT_DB_PREFIX
} from '../../src/cli/config.ts'

test('parseServeArgs returns defaults when no flags given', () => {
  const options = parseServeArgs([])

  assert.deepEqual(options, {
    port: 3847,
    host: 'localhost',
    open: true,
    dbPrefix: DEFAULT_DB_PREFIX
  })
})

test('parseServeArgs reads --db-prefix', () => {
  const options = parseServeArgs(['--db-prefix', 'custom-'])
  assert.equal(options.dbPrefix, 'custom-')
})

test('parseServeArgs treats --db-prefix "" as an explicit override, not unset', () => {
  const options = parseServeArgs(['--db-prefix', ''])
  assert.equal(options.dbPrefix, '')
})

test('resolveDbPrefix: explicit value wins over env var and default', () => {
  const original = process.env.GITHUMAN_DB_PREFIX
  process.env.GITHUMAN_DB_PREFIX = 'from-env-'
  try {
    assert.equal(resolveDbPrefix('from-flag-'), 'from-flag-')
  } finally {
    if (original === undefined) delete process.env.GITHUMAN_DB_PREFIX
    else process.env.GITHUMAN_DB_PREFIX = original
  }
})

test('resolveDbPrefix: env var wins over default when no explicit value', () => {
  const original = process.env.GITHUMAN_DB_PREFIX
  process.env.GITHUMAN_DB_PREFIX = 'from-env-'
  try {
    assert.equal(resolveDbPrefix(), 'from-env-')
  } finally {
    if (original === undefined) delete process.env.GITHUMAN_DB_PREFIX
    else process.env.GITHUMAN_DB_PREFIX = original
  }
})

test('resolveDbPrefix: an explicit empty string is a valid override (interop with the original mcollina/githuman filenames)', () => {
  const original = process.env.GITHUMAN_DB_PREFIX
  process.env.GITHUMAN_DB_PREFIX = 'from-env-'
  try {
    assert.equal(resolveDbPrefix(''), '')
  } finally {
    if (original === undefined) delete process.env.GITHUMAN_DB_PREFIX
    else process.env.GITHUMAN_DB_PREFIX = original
  }
})

test('resolveDbPrefix: falls back to DEFAULT_DB_PREFIX when nothing is set', () => {
  const original = process.env.GITHUMAN_DB_PREFIX
  delete process.env.GITHUMAN_DB_PREFIX
  try {
    assert.equal(resolveDbPrefix(), DEFAULT_DB_PREFIX)
  } finally {
    if (original !== undefined) process.env.GITHUMAN_DB_PREFIX = original
  }
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
