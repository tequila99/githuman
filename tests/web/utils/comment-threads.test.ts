import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Comment } from '@/api/types'
import {
  diffCommentThreads,
  commentsForDiffLine,
  commentsByLine
} from '@/utils/comment-threads'

function comment(
  id: string,
  lineType: Comment['lineType'],
  end: number | null
): Comment {
  return {
    id,
    lineType,
    lineNumberEnd: end,
    lineNumber: end,
    content: id,
    filePath: 'a.ts',
    reviewId: 'review',
    createdAt: '',
    updatedAt: ''
  }
}

test('diff threads use removed old-side numbers and other new-side numbers', () => {
  const removed = comment('old', 'removed', 5),
    added = comment('new', 'added', 7),
    context = comment('context', 'context', 7)
  const threads = diffCommentThreads([
    removed,
    added,
    context,
    comment('file', 'added', null)
  ])
  assert.deepEqual(
    commentsForDiffLine({ oldLineNumber: 5, newLineNumber: 7 }, threads),
    [removed, added, context]
  )
  assert.deepEqual(
    commentsForDiffLine({ oldLineNumber: 7, newLineNumber: null }, threads),
    []
  )
  assert.deepEqual(
    commentsForDiffLine({ oldLineNumber: null, newLineNumber: 5 }, threads),
    []
  )
})

test('full-file thread grouping preserves all comments at the same endpoint', () => {
  const a = comment('a', null, 5),
    b = comment('b', null, 5)
  const threads = commentsByLine([a, b, comment('file', null, null)])
  assert.deepEqual([...threads], [[5, [a, b]]])
})
