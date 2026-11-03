import assert from 'node:assert/strict'
import { test } from 'node:test'
import { takeWithinBytes } from '../../../src/server/utils/take-within-bytes.ts'
import { truncateUtf8Text } from '../../../src/server/utils/text.ts'

test('page budget measures escaped JSON and retains one complete oversized item', () => {
  const items = [
    { text: '\u0001'.repeat(20) },
    { text: 'plain' },
    { text: 'end' }
  ]
  assert.deepEqual(takeWithinBytes(items, 3, 50), [items[0]])
  assert.deepEqual(takeWithinBytes(items, 1, 1000), [items[0]])
  assert.deepEqual(takeWithinBytes([], 3, 50), [])
  const rest = takeWithinBytes(items.slice(1), 3, 50)
  assert.deepEqual(rest, items.slice(1))
})

test('UTF-8 previews never introduce a partial Unicode code point', () => {
  assert.equal(truncateUtf8Text('a🧪b', 4), 'a')
  assert.equal(truncateUtf8Text('a🧪b', 5), 'a🧪')
  assert.equal(truncateUtf8Text('a🧪b', 6), 'a🧪b')
})
