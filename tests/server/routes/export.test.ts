import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTempGitRepo } from '../helpers/git-fixture.ts'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { buildApp } from '../../../src/server/app.ts'

async function setupAppWithReview(t: { after: (fn: () => unknown) => void }) {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  const db = createTestDatabase()
  const app = buildApp({ repositoryPath: fixture.dir, db })
  t.after(async () => {
    await app.close()
  })

  const created = await app.inject({
    method: 'POST',
    url: '/api/reviews',
    payload: { sourceType: 'staged' }
  })
  const reviewId = created.json().id

  return { app, reviewId }
}

test('GET /api/reviews/:id/export?format=json returns the review and comments as JSON', async t => {
  const { app, reviewId } = await setupAppWithReview(t)

  const response = await app.inject({
    method: 'GET',
    url: `/api/reviews/${reviewId}/export?format=json`
  })

  assert.equal(response.statusCode, 200)
  assert.match(response.headers['content-type'] as string, /application\/json/)
  const body = response.json()
  assert.equal(body.review.id, reviewId)
  assert.deepEqual(body.comments, [])
})

test('GET /api/reviews/:id/export?format=markdown returns markdown text', async t => {
  const { app, reviewId } = await setupAppWithReview(t)

  const response = await app.inject({
    method: 'GET',
    url: `/api/reviews/${reviewId}/export?format=markdown`
  })

  assert.equal(response.statusCode, 200)
  assert.match(
    response.headers['content-type'] as string,
    /text\/(markdown|plain)/
  )
  assert.match(response.body, /^# /)
})

test('GET /api/reviews/:id/export for an unknown review returns 404', async t => {
  const { app } = await setupAppWithReview(t)

  const response = await app.inject({
    method: 'GET',
    url: '/api/reviews/does-not-exist/export?format=json'
  })

  assert.equal(response.statusCode, 404)
})

test('GET /api/reviews/:id/export with an unknown format returns 400', async t => {
  const { app, reviewId } = await setupAppWithReview(t)

  const response = await app.inject({
    method: 'GET',
    url: `/api/reviews/${reviewId}/export?format=xml`
  })

  assert.equal(response.statusCode, 400)
})

test('GET /api/reviews/:id/export without a format returns 400', async t => {
  const { app, reviewId } = await setupAppWithReview(t)

  const response = await app.inject({
    method: 'GET',
    url: `/api/reviews/${reviewId}/export`
  })

  assert.equal(response.statusCode, 400)
})
