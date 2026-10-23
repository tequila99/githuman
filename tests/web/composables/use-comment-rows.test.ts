import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shallowRef } from 'vue'
import type { Comment, DiffHunk } from '@/api/types'
import { createAnchor, type CommentAnchor } from '@/utils/comment-anchor'
import { useDiffHunkRows } from '@/composables/use-diff-hunk-rows'
import { useFullFileRows } from '@/composables/use-full-file-rows'

function comment(
  id: string,
  type: Comment['lineType'],
  start: number,
  end = start
): Comment {
  return {
    id,
    lineType: type,
    lineNumber: start,
    lineNumberEnd: end,
    content: id,
    filePath: 'a.ts',
    reviewId: 'review',
    createdAt: '',
    updatedAt: ''
  }
}
function hunk(): DiffHunk {
  return {
    oldStart: 1,
    oldLines: 3,
    newStart: 10,
    newLines: 3,
    lines: [
      { type: 'context', content: 'one', oldLineNumber: 1, newLineNumber: 10 },
      {
        type: 'removed',
        content: 'old',
        oldLineNumber: 2,
        newLineNumber: null
      },
      { type: 'added', content: 'new', oldLineNumber: null, newLineNumber: 11 },
      { type: 'context', content: 'two', oldLineNumber: 3, newLineNumber: 12 }
    ]
  }
}

test('review filtering retains original token indices and old/new thread endpoints', () => {
  const source = shallowRef(hunk())
  const old = comment('old', 'removed', 2)
  const added = comment('new', 'added', 11, 12)
  const commentsOnly = shallowRef(true)
  const rows = useDiffHunkRows({
    hunk: () => source.value,
    comments: [old, added],
    commentsOnly,
    commentsEditable: false,
    wrap: false,
    anchor: null
  })
  assert.deepEqual(
    rows.visibleLines.value.map(row => row.index),
    [1, 2, 3]
  )
  assert.deepEqual(
    rows.visibleLines.value.map(row => row.comments),
    [[old], [], [added]]
  )
  assert.equal(rows.grouping.value.segmented, false)
  commentsOnly.value = false
  assert.deepEqual(
    rows.visibleLines.value.map(row => row.index),
    [0, 1, 2, 3]
  )
  assert.equal(rows.grouping.value.segmented, true)
  assert.equal(rows.segments.value[0]?.props.heightOwner, source.value)
})

test('form pinning and wrap disable height caching without changing segment ownership', () => {
  const source = hunk()
  const anchor = shallowRef<CommentAnchor | null>(null)
  const wrap = shallowRef(false)
  const rows = useDiffHunkRows({
    hunk: source,
    comments: [],
    commentsOnly: false,
    commentsEditable: true,
    wrap,
    anchor
  })
  const before = rows.segments.value[0]!.props
  assert.equal(before.cacheHeight, true)
  assert.equal(before.keep, false)
  anchor.value = createAnchor('old', 2, 2, [{ key: 2, text: 'old' }])
  const pinned = rows.segments.value[0]!.props
  assert.equal(pinned.keep, true)
  assert.equal(pinned.cacheHeight, false)
  assert.equal(pinned.widthSensitive, true)
  assert.notEqual(pinned.heightVersion, before.heightVersion)
  assert.equal(pinned.heightOwner, before.heightOwner)
  anchor.value = null
  wrap.value = true
  assert.equal(rows.segments.value[0]!.props.keep, false)
  assert.equal(rows.segments.value[0]!.props.cacheHeight, false)
})

test('full-file segments retain source identity, one-based numbers and only pin the form segment', () => {
  const source = shallowRef(Array.from({ length: 230 }, (_, i) => `line ${i}`))
  const anchor = shallowRef<CommentAnchor | null>(
    createAnchor('full', 28, 30, [])
  )
  const saved = comment('saved', null, 2, 4)
  const rows = useFullFileRows({
    lines: () => source.value,
    comments: [saved],
    commentsEditable: false,
    wrap: false,
    anchor
  })
  assert.equal(rows.grouping.value.segmented, true)
  assert.equal(rows.segments.value[0]!.rows[3]!.lineNumber, 4)
  assert.deepEqual(rows.segments.value[0]!.rows[3]!.comments, [saved])
  assert.equal(rows.segments.value[0]!.props.keep, false)
  assert.equal(rows.segments.value[1]!.props.keep, true)
  assert.equal(rows.segments.value[1]!.props.heightKey, 'rows:25')
  assert.ok(
    rows.segments.value.every(
      segment => segment.props.heightOwner === source.value
    )
  )
  source.value = ['replacement']
  assert.equal(rows.grouping.value.segmented, false)
  assert.equal(rows.segments.value[0]!.props.heightOwner, source.value)
})
