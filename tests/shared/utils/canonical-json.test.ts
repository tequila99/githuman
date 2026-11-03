import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalJson } from '../../../src/shared/utils/canonical-json.ts'

test('canonical JSON ignores nested object key order while retaining arrays, Unicode and null', () => {
  const left = {
    b: [{ z: null, a: '🧪' }, true, 1],
    a: { y: 2, x: 'text' },
    optional: undefined
  }
  const right = { a: { x: 'text', y: 2 }, b: [{ a: '🧪', z: null }, true, 1] }
  assert.equal(canonicalJson(left), canonicalJson(right))
  assert.deepEqual(JSON.parse(canonicalJson(left)), right)
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]))
  assert.throws(() => canonicalJson(undefined), TypeError)
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => canonicalJson({ value }), TypeError)
  }
})
