import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Comment, DiffFile } from '@/api/types'
import {
  diffCardBodyHeight,
  commentHeightEstimate
} from '@/utils/diff-card-height'

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
    reviewId: 'r',
    createdAt: '',
    updatedAt: ''
  }
}

test('summary estimates context, detail estimates actual hunk rows and empty detail stays empty', () => {
  const file: DiffFile = {
    oldPath: 'a.ts',
    newPath: 'a.ts',
    status: 'modified',
    additions: 10,
    deletions: 5,
    isBinary: false,
    hunks: []
  }
  assert.equal(diffCardBodyHeight(file), 380)
  assert.equal(diffCardBodyHeight(file, file), 0)
  const line = {
    type: 'added' as const,
    oldLineNumber: null,
    newLineNumber: 1,
    content: 'a'
  }
  const detail: DiffFile = {
    ...file,
    hunks: [
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 2,
        lines: [line, line]
      }
    ]
  }
  assert.equal(diffCardBodyHeight(file, detail), 65)
})

test('estimates old/new/full endpoint branches independently without counting comment duplicates', () => {
  const comments = [
    comment('a', 'removed', 5),
    comment('b', 'added', 5),
    comment('c', 'context', 5),
    comment('d', null, 5),
    comment('e', null, 5),
    comment('none', 'added', null)
  ]
  assert.equal(commentHeightEstimate(comments, 'diff'), 180)
  assert.equal(commentHeightEstimate(comments, 'full'), 90)
})
