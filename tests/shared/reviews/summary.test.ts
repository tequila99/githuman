import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toReviewSummary } from '../../../src/shared/reviews/summary.ts'
import type { Review } from '../../../src/shared/reviews/types.ts'

test('toReviewSummary drops only the snapshot', () => {
  const review: Review = {
    id: 'r1',
    repositoryPath: '/repo',
    baseRef: null,
    sourceType: 'local',
    sourceRef: null,
    snapshotData: '[{"big":"diff"}]',
    status: 'in_progress',
    name: 'n',
    branch: 'main',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  const summary = toReviewSummary(review)

  assert.equal('snapshotData' in summary, false)
  const { snapshotData: _snapshot, ...expected } = review
  assert.deepEqual(summary, expected)
})
