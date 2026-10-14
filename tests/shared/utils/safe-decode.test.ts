import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeDecodeURIComponent } from '../../../src/shared/utils/safe-decode.ts'

test('decodes valid escapes and keeps malformed input as is', () => {
  assert.equal(safeDecodeURIComponent('a%20b'), 'a b')
  assert.equal(safeDecodeURIComponent('100%'), '100%')
  assert.equal(safeDecodeURIComponent('%E0'), '%E0')
})
