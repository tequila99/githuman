import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractToolContent } from '../../../../src/server/adapters/agents/event-mapper.ts'

const BIG = 'x'.repeat(30_000)

test('a diff within the cap is passed on unchanged', () => {
  const { diffs } = extractToolContent([
    { type: 'diff', path: 'a.txt', oldText: null, newText: 'hi' }
  ])
  assert.deepEqual(diffs, [{ path: 'a.txt', oldText: null, newText: 'hi' }])
})

test('a larger diff is cut and marked as cut', () => {
  const { diffs } = extractToolContent(
    [{ type: 'diff', path: 'a.txt', oldText: BIG, newText: BIG }],
    1_000
  )
  assert.equal(diffs[0]?.newText.length, 1_000)
  assert.equal(diffs[0]?.oldText?.length, 1_000)
  assert.equal(diffs[0]?.truncated, true)
})
