import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { createReview } from '../../../src/server/repositories/review.repo.ts'
import { createComment } from '../../../src/server/repositories/comment.repo.ts'
import {
  runExport,
  ExportCliError,
  parseExportArgs
} from '../../../src/cli/commands/export.ts'
import { DEFAULT_DB_PREFIX } from '../../../src/cli/config.ts'
import type { Review, Comment } from '../../../src/shared/types.ts'

function makeReview(overrides: Partial<Review> = {}): Review {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    repositoryPath: '/repo',
    baseRef: null,
    sourceType: 'staged',
    sourceRef: null,
    snapshotData: JSON.stringify([
      {
        oldPath: 'a.txt',
        newPath: 'a.txt',
        additions: 1,
        deletions: 0,
        hunks: []
      }
    ]),
    status: 'in_progress',
    name: null,
    branch: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

function makeComment(
  reviewId: string,
  overrides: Partial<Comment> = {}
): Comment {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    reviewId,
    filePath: 'a.txt',
    lineNumber: null,
    lineNumberEnd: null,
    lineType: null,
    content: 'looks good',
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

test('runExport(db, id, "json") returns valid JSON with review + comments', () => {
  const db = createTestDatabase()
  const review = createReview(db, makeReview())
  createComment(db, makeComment(review.id))

  const output = runExport(db, review.id, 'json')
  const parsed = JSON.parse(output)

  assert.equal(parsed.review.id, review.id)
  assert.equal(parsed.comments.length, 1)
})

test('runExport(db, id, "markdown") returns the markdown export', () => {
  const db = createTestDatabase()
  const review = createReview(db, makeReview())

  const output = runExport(db, review.id, 'markdown')

  assert.match(output, /# Ревью:/)
})

test('runExport(db, "last", ...) resolves to the most recently created review', () => {
  const db = createTestDatabase()
  createReview(db, makeReview({ createdAt: '2026-01-01T00:00:00.000Z' }))
  const latest = createReview(
    db,
    makeReview({ createdAt: '2026-02-01T00:00:00.000Z' })
  )

  const output = runExport(db, 'last', 'json')
  const parsed = JSON.parse(output)

  assert.equal(parsed.review.id, latest.id)
})

test('runExport with an unknown id throws ExportCliError with a clear message, not a raw exception', () => {
  const db = createTestDatabase()

  assert.throws(
    () => runExport(db, 'does-not-exist', 'markdown'),
    ExportCliError
  )
})

test('runExport("last") with no reviews at all throws ExportCliError', () => {
  const db = createTestDatabase()

  assert.throws(() => runExport(db, 'last', 'markdown'), ExportCliError)
})

test('parseExportArgs reads the positional id, --format and -o/--output', () => {
  assert.deepEqual(parseExportArgs(['abc-123']), {
    id: 'abc-123',
    format: 'markdown',
    output: undefined,
    dbPrefix: DEFAULT_DB_PREFIX
  })
  assert.deepEqual(parseExportArgs(['abc-123', '--format', 'json']), {
    id: 'abc-123',
    format: 'json',
    output: undefined,
    dbPrefix: DEFAULT_DB_PREFIX
  })
  assert.deepEqual(parseExportArgs(['last', '-o', 'out.md']), {
    id: 'last',
    format: 'markdown',
    output: 'out.md',
    dbPrefix: DEFAULT_DB_PREFIX
  })
  assert.deepEqual(parseExportArgs(['last', '--output', 'out.md']), {
    id: 'last',
    format: 'markdown',
    output: 'out.md',
    dbPrefix: DEFAULT_DB_PREFIX
  })
})

test('parseExportArgs reads --db-prefix', () => {
  assert.deepEqual(parseExportArgs(['abc-123', '--db-prefix', 'custom-']), {
    id: 'abc-123',
    format: 'markdown',
    output: undefined,
    dbPrefix: 'custom-'
  })
})

test('parseExportArgs throws when the id is missing', () => {
  assert.throws(() => parseExportArgs([]))
})

test('parseExportArgs throws on an invalid --format value', () => {
  assert.throws(() => parseExportArgs(['abc-123', '--format', 'yaml']))
})
