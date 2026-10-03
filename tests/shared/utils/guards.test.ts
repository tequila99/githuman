import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isRecord } from '../../../src/shared/utils/guards.ts'

test('plain objects are records, including empty ones and class instances', () => {
  assert.equal(isRecord({}), true)
  assert.equal(isRecord({ a: 1 }), true)
  assert.equal(isRecord(Object.create(null)), true)
  assert.equal(isRecord(new Map()), true)
})

test('null, arrays and primitives are not records', () => {
  for (const value of [null, undefined, [], [1], 'text', 42, true, () => {}]) {
    assert.equal(isRecord(value), false, String(value))
  }
})
