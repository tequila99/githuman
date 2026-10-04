import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  groupRows,
  SEGMENT_SIZE,
  SEGMENT_THRESHOLD
} from '@/utils/row-segments'

const rowsOf = (count: number) => Array.from({ length: count }, (_, i) => i)

test('a list at the threshold stays one group', () => {
  const { segmented, groups } = groupRows(rowsOf(SEGMENT_THRESHOLD))

  assert.equal(segmented, false)
  assert.equal(groups.length, 1)
  assert.equal(groups[0]!.rows.length, SEGMENT_THRESHOLD)
})

test('a longer list splits into segments that keep every row once, in order', () => {
  const total = SEGMENT_THRESHOLD + 51
  const { segmented, groups } = groupRows(rowsOf(total))

  assert.equal(segmented, true)
  assert.deepEqual(
    groups.map(group => group.start),
    [0, SEGMENT_SIZE, 2 * SEGMENT_SIZE]
  )
  assert.deepEqual(
    groups.flatMap(group => group.rows),
    rowsOf(total)
  )
})

test('an empty list is one empty group', () => {
  const { segmented, groups } = groupRows([])

  assert.equal(segmented, false)
  assert.deepEqual(groups, [{ start: 0, rows: [] }])
})
