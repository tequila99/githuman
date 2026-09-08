import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { createReview } from '../../../src/server/repositories/review.repo.ts'
import { createComment } from '../../../src/server/repositories/comment.repo.ts'
import {
  exportAsJson,
  exportAsMarkdown,
  formatReviewAsMarkdown,
  ExportNotFoundError
} from '../../../src/server/services/export.service.ts'
import type { DiffFile, Review } from '../../../src/shared/types.ts'

const sampleFiles: DiffFile[] = [
  {
    oldPath: 'a.txt',
    newPath: 'a.txt',
    status: 'modified',
    additions: 1,
    deletions: 1,
    isBinary: false,
    hunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [
          {
            type: 'removed',
            content: 'old line',
            oldLineNumber: 1,
            newLineNumber: null
          },
          {
            type: 'added',
            content: 'new line',
            oldLineNumber: null,
            newLineNumber: 1
          }
        ]
      }
    ]
  }
]

function makeReview(overrides: Partial<Review> = {}): Review {
  const now = new Date().toISOString()
  return {
    id: 'review-1',
    repositoryPath: '/repo',
    baseRef: null,
    sourceType: 'staged',
    sourceRef: null,
    snapshotData: JSON.stringify(sampleFiles),
    status: 'in_progress',
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

test('exportAsJson returns the review and its comments', () => {
  const db = createTestDatabase()
  createReview(db, makeReview())
  createComment(db, {
    id: 'c1',
    reviewId: 'review-1',
    filePath: 'a.txt',
    lineNumber: 1,
    lineType: 'added',
    content: 'nice',
    createdAt: 'x',
    updatedAt: 'x'
  })

  const result = exportAsJson(db, 'review-1')

  assert.equal(result.review.id, 'review-1')
  assert.equal(result.comments.length, 1)
  assert.equal(result.comments[0].content, 'nice')
  db.close()
})

test('exportAsJson returns comments: [] when there are none', () => {
  const db = createTestDatabase()
  createReview(db, makeReview())

  const result = exportAsJson(db, 'review-1')

  assert.deepEqual(result.comments, [])
  db.close()
})

test('exportAsJson throws ExportNotFoundError for an unknown review', () => {
  const db = createTestDatabase()
  assert.throws(() => exportAsJson(db, 'does-not-exist'), ExportNotFoundError)
  db.close()
})

test('formatReviewAsMarkdown includes a header, both files, both comments, and fenced diff blocks', () => {
  const files: DiffFile[] = [
    ...sampleFiles,
    {
      oldPath: 'b.txt',
      newPath: 'b.txt',
      status: 'added',
      additions: 1,
      deletions: 0,
      isBinary: false,
      hunks: [
        {
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 1,
          lines: [
            {
              type: 'added',
              content: 'brand new',
              oldLineNumber: null,
              newLineNumber: 1
            }
          ]
        }
      ]
    }
  ]
  const comments = [
    {
      id: 'c1',
      reviewId: 'review-1',
      filePath: 'a.txt',
      lineNumber: 1,
      lineType: 'added' as const,
      content: 'comment on a',
      createdAt: 'x',
      updatedAt: 'x'
    },
    {
      id: 'c2',
      reviewId: 'review-1',
      filePath: 'b.txt',
      lineNumber: 1,
      lineType: 'added' as const,
      content: 'comment on b',
      createdAt: 'x',
      updatedAt: 'x'
    }
  ]

  const markdown = formatReviewAsMarkdown(makeReview(), files, comments)

  assert.match(markdown, /^# /)
  assert.ok(markdown.includes('a.txt'))
  assert.ok(markdown.includes('b.txt'))
  assert.ok(markdown.includes('comment on a'))
  assert.ok(markdown.includes('comment on b'))
  assert.ok(markdown.includes('```diff'))
  assert.ok(markdown.includes('-old line'))
  assert.ok(markdown.includes('+new line'))
})

test('formatReviewAsMarkdown with no comments produces no comment sections and no "undefined"', () => {
  const markdown = formatReviewAsMarkdown(makeReview(), sampleFiles, [])

  assert.ok(!markdown.includes('undefined'))
  assert.ok(!markdown.includes('Комментарии'))
})

test('exportAsMarkdown produces markdown from stored review data', () => {
  const db = createTestDatabase()
  createReview(db, makeReview())

  const markdown = exportAsMarkdown(db, 'review-1')

  assert.ok(markdown.includes('a.txt'))
  db.close()
})

test('exportAsMarkdown throws ExportNotFoundError for an unknown review', () => {
  const db = createTestDatabase()
  assert.throws(
    () => exportAsMarkdown(db, 'does-not-exist'),
    ExportNotFoundError
  )
  db.close()
})
