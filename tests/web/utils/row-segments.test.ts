import { test } from 'node:test'
import type { Comment } from '@/api/types'
import assert from 'node:assert/strict'
import {
  groupRows,
  ROW_HEIGHT,
  SEGMENT_COST,
  SEGMENT_SIZE,
  SEGMENT_THRESHOLD,
  segmentSize,
  rowSegmentProps,
  THREAD_COST,
  THREAD_HEIGHT_ESTIMATE
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
    Array.from(
      { length: Math.ceil(total / SEGMENT_SIZE) },
      (_, i) => i * SEGMENT_SIZE
    )
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

test('a threshold of 0 makes segments even of a short list', () => {
  const { segmented, groups } = groupRows(rowsOf(3), 0)

  assert.equal(segmented, true)
  assert.deepEqual(groups, [{ start: 0, rows: [0, 1, 2] }])
})

test('a threshold of 0 keeps an empty list as one group without segments', () => {
  const { segmented } = groupRows([], 0)

  assert.equal(segmented, false)
})

test('a segment and its comment threads add to the mount cost and the height guess', () => {
  assert.deepEqual(segmentSize(10, 2), {
    minHeight: 10 * ROW_HEIGHT + 2 * THREAD_HEIGHT_ESTIMATE,
    cost: SEGMENT_COST + 10 + 2 * THREAD_COST
  })
})

test('segment geometry distinguishes content, forms and access without edit-history keys', () => {
  const owner = {}
  const comment = {
    id: 'comment-id',
    content: 'abcdef',
    suggestion: null,
    resolved: false,
    lineNumber: 1,
    lineNumberEnd: 1,
    lineType: null,
    filePath: 'a.ts',
    reviewId: 'review',
    createdAt: '',
    updatedAt: ''
  } satisfies Comment
  const rows = [
    { comments: [comment], form: false },
    { comments: [] as Comment[], form: false }
  ]
  const options = {
    comments: (row: (typeof rows)[number]) => row.comments,
    hasForm: (row: (typeof rows)[number]) => row.form,
    owner,
    wrap: false,
    commentsEditable: true
  }
  const initial = rowSegmentProps({ start: 0, rows }, options)
  assert.equal(initial.cacheHeight, false)
  assert.equal(initial.widthSensitive, true)
  assert.equal(initial.keep, false)
  assert.equal(initial.minHeight, 2 * ROW_HEIGHT + THREAD_HEIGHT_ESTIMATE)
  assert.equal(
    rowSegmentProps({ start: 0, rows }, options).heightVersion,
    initial.heightVersion
  )
  comment.content = 'a\nb\nc\n'
  const edited = rowSegmentProps({ start: 0, rows }, options)
  assert.equal(edited.heightKey, initial.heightKey)
  assert.notEqual(edited.heightVersion, initial.heightVersion)
  rows[1]!.form = true
  assert.equal(rowSegmentProps({ start: 0, rows }, options).keep, true)
  assert.notEqual(
    rowSegmentProps({ start: 0, rows }, { ...options, commentsEditable: false })
      .heightVersion,
    rowSegmentProps({ start: 0, rows }, options).heightVersion
  )
})

test('only fixed leaf code rows are externally cached; multiple comments cost one thread', () => {
  const comment = {
    id: 'c',
    content: 'text',
    lineNumber: 1,
    lineNumberEnd: 1,
    lineType: null,
    filePath: 'a.ts',
    reviewId: 'r',
    createdAt: '',
    updatedAt: ''
  } satisfies Comment
  const options = {
    comments: (comments: Comment[]) => comments,
    hasForm: () => false,
    owner: {},
    wrap: false,
    commentsEditable: false
  }
  assert.equal(
    rowSegmentProps({ start: 0, rows: [[]] }, options).cacheHeight,
    true
  )
  assert.equal(
    rowSegmentProps({ start: 0, rows: [[]] }, { ...options, wrap: true })
      .cacheHeight,
    false
  )
  assert.equal(
    rowSegmentProps(
      { start: 0, rows: [[]] },
      { ...options, cacheHeight: false }
    ).cacheHeight,
    false
  )
  assert.equal(
    rowSegmentProps({ start: 0, rows: [[comment, comment]] }, options).cost,
    SEGMENT_COST + 1 + THREAD_COST
  )
})
