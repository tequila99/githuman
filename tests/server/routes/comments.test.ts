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

test('POST /api/reviews/:id/comments creates a comment', async t => {
  const { app, reviewId } = await setupAppWithReview(t)

  const response = await app.inject({
    method: 'POST',
    url: `/api/reviews/${reviewId}/comments`,
    payload: {
      filePath: 'a.txt',
      lineNumber: 5,
      lineType: 'added',
      content: 'looks good'
    }
  })

  assert.equal(response.statusCode, 201)
  const comment = response.json()
  assert.ok(comment.id)
  assert.equal(comment.content, 'looks good')
  assert.ok(comment.createdAt)
  assert.ok(comment.updatedAt)
})

test('POST /api/reviews/:id/comments with empty content returns 400', async t => {
  const { app, reviewId } = await setupAppWithReview(t)

  const response = await app.inject({
    method: 'POST',
    url: `/api/reviews/${reviewId}/comments`,
    payload: { filePath: 'a.txt', content: '' }
  })

  assert.equal(response.statusCode, 400)
})

test('POST /api/reviews/:id/comments for an unknown review returns 404', async t => {
  const { app } = await setupAppWithReview(t)

  const response = await app.inject({
    method: 'POST',
    url: '/api/reviews/does-not-exist/comments',
    payload: { filePath: 'a.txt', content: 'x' }
  })

  assert.equal(response.statusCode, 404)
})

test("GET /api/reviews/:id/comments lists only that review's comments", async t => {
  const { app, reviewId } = await setupAppWithReview(t)
  const other = await app.inject({
    method: 'POST',
    url: '/api/reviews',
    payload: { sourceType: 'staged' }
  })
  const otherId = other.json().id

  await app.inject({
    method: 'POST',
    url: `/api/reviews/${reviewId}/comments`,
    payload: { filePath: 'a.txt', content: 'mine' }
  })
  await app.inject({
    method: 'POST',
    url: `/api/reviews/${otherId}/comments`,
    payload: { filePath: 'a.txt', content: 'other' }
  })

  const response = await app.inject({
    method: 'GET',
    url: `/api/reviews/${reviewId}/comments`
  })

  assert.equal(response.statusCode, 200)
  const comments = response.json()
  assert.equal(comments.length, 1)
  assert.equal(comments[0].content, 'mine')
})

test('PATCH /api/comments/:id updates content', async t => {
  const { app, reviewId } = await setupAppWithReview(t)
  const created = await app.inject({
    method: 'POST',
    url: `/api/reviews/${reviewId}/comments`,
    payload: { filePath: 'a.txt', content: 'original' }
  })
  const id = created.json().id

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/comments/${id}`,
    payload: { content: 'edited' }
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().content, 'edited')
})

test('PATCH /api/comments/:id for an unknown id returns 404', async t => {
  const { app } = await setupAppWithReview(t)

  const response = await app.inject({
    method: 'PATCH',
    url: '/api/comments/does-not-exist',
    payload: { content: 'x' }
  })

  assert.equal(response.statusCode, 404)
})

test('POST /api/reviews/:id/comments accepts an optional suggestion', async t => {
  const { app, reviewId } = await setupAppWithReview(t)

  const response = await app.inject({
    method: 'POST',
    url: `/api/reviews/${reviewId}/comments`,
    payload: {
      filePath: 'a.txt',
      content: 'consider this',
      suggestion: 'const x = 1;'
    }
  })

  assert.equal(response.statusCode, 201)
  assert.equal(response.json().suggestion, 'const x = 1;')
})

test('PATCH /api/comments/:id/resolve marks the comment resolved', async t => {
  const { app, reviewId } = await setupAppWithReview(t)
  const created = await app.inject({
    method: 'POST',
    url: `/api/reviews/${reviewId}/comments`,
    payload: { filePath: 'a.txt', content: 'x' }
  })
  const id = created.json().id

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/comments/${id}/resolve`
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().resolved, true)
})

test('PATCH /api/comments/:id/unresolve marks the comment unresolved', async t => {
  const { app, reviewId } = await setupAppWithReview(t)
  const created = await app.inject({
    method: 'POST',
    url: `/api/reviews/${reviewId}/comments`,
    payload: { filePath: 'a.txt', content: 'x' }
  })
  const id = created.json().id
  await app.inject({ method: 'PATCH', url: `/api/comments/${id}/resolve` })

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/comments/${id}/unresolve`
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().resolved, false)
})

test('PATCH /api/comments/:id/resolve for an unknown id returns 404', async t => {
  const { app } = await setupAppWithReview(t)

  const response = await app.inject({
    method: 'PATCH',
    url: '/api/comments/does-not-exist/resolve'
  })

  assert.equal(response.statusCode, 404)
})

test("DELETE /api/comments/:id removes it from the review's comment list", async t => {
  const { app, reviewId } = await setupAppWithReview(t)
  const created = await app.inject({
    method: 'POST',
    url: `/api/reviews/${reviewId}/comments`,
    payload: { filePath: 'a.txt', content: 'to be deleted' }
  })
  const id = created.json().id

  const deleteResponse = await app.inject({
    method: 'DELETE',
    url: `/api/comments/${id}`
  })
  assert.equal(deleteResponse.statusCode, 204)

  const list = await app.inject({
    method: 'GET',
    url: `/api/reviews/${reviewId}/comments`
  })
  assert.equal(list.json().length, 0)
})
