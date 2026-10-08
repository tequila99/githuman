import { test } from 'node:test'
import assert from 'node:assert/strict'
import { segmentHeight, rememberSegmentHeight } from '@/utils/segment-heights'

test('height slots belong to an owner and one current version', () => {
  const owner = {},
    other = {}
  rememberSegmentHeight(owner, 'rows:0', 'first', 500)
  rememberSegmentHeight(owner, 'rows:25', 'first', 100)
  assert.equal(segmentHeight(owner, 'rows:0', 'first'), 500)
  assert.equal(segmentHeight(owner, 'rows:25', 'first'), 100)
  assert.equal(segmentHeight(other, 'rows:0', 'first'), undefined)
  for (let i = 0; i < 100; i++)
    rememberSegmentHeight(owner, 'rows:0', `edit:${i}`, i)
  assert.equal(segmentHeight(owner, 'rows:0', 'first'), undefined)
  assert.equal(segmentHeight(owner, 'rows:0', 'edit:98'), undefined)
  assert.equal(segmentHeight(owner, 'rows:0', 'edit:99'), 99)
  assert.equal(segmentHeight(owner, 'rows:25', 'first'), 100)
})
