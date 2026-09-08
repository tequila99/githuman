import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { createReview } from '../../../src/server/repositories/review.repo.ts'
import { runList, parseListArgs } from '../../../src/cli/commands/list.ts'
import type { Review } from '../../../src/shared/types.ts'

function makeReview(overrides: Partial<Review> = {}): Review {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    repositoryPath: '/repo',
    baseRef: null,
    sourceType: 'staged',
    sourceRef: null,
    snapshotData: '[]',
    status: 'in_progress',
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

test('runList prints id/status/date for each review, most recent first', () => {
  const db = createTestDatabase()
  const first = createReview(
    db,
    makeReview({ createdAt: '2026-01-01T00:00:00.000Z' })
  )
  const second = createReview(
    db,
    makeReview({ createdAt: '2026-02-01T00:00:00.000Z' })
  )

  const output = runList(db)

  assert.match(output, new RegExp(second.id))
  assert.match(output, new RegExp(first.id))
  assert.ok(output.indexOf(second.id) < output.indexOf(first.id))
})

test('runList with no reviews prints a friendly empty message, not an empty string', () => {
  const db = createTestDatabase()
  const output = runList(db)
  assert.ok(output.length > 0)
})

test('runList({json: true}) returns a valid JSON array of reviews', () => {
  const db = createTestDatabase()
  const review = createReview(db, makeReview())

  const output = runList(db, { json: true })
  const parsed = JSON.parse(output)

  assert.ok(Array.isArray(parsed))
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].id, review.id)
})

test('runList({status}) filters to only reviews with that status', () => {
  const db = createTestDatabase()
  const approved = createReview(db, makeReview({ status: 'approved' }))
  createReview(db, makeReview({ status: 'in_progress' }))

  const output = runList(db, { json: true, status: 'approved' })
  const parsed = JSON.parse(output)

  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].id, approved.id)
})

test('parseListArgs reads --json and --status flags', () => {
  assert.deepEqual(parseListArgs(['--json']), { json: true, status: undefined })
  assert.deepEqual(parseListArgs(['--status', 'approved']), {
    json: false,
    status: 'approved'
  })
  assert.deepEqual(parseListArgs([]), { json: false, status: undefined })
})
