import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTempGitRepo } from '../helpers/git-fixture.ts'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { buildApp } from '../../../src/server/app.ts'

async function stageOneChange(
  fixtureDir: string,
  git: Awaited<ReturnType<typeof createTempGitRepo>>['git']
) {
  writeFileSync(join(fixtureDir, 'a.txt'), 'v1\n')
  await git.add('a.txt')
  await git.commit('add a.txt')
  writeFileSync(join(fixtureDir, 'a.txt'), 'v2\n')
  await git.add('a.txt')
}

test('POST /api/reviews (staged) creates a review with status in_progress', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  await stageOneChange(fixture.dir, fixture.git)

  const db = createTestDatabase()
  const app = buildApp({ repositoryPath: fixture.dir, db })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'POST',
    url: '/api/reviews',
    payload: { sourceType: 'staged' }
  })

  assert.equal(response.statusCode, 201)
  const review = response.json()
  assert.equal(review.status, 'in_progress')
  assert.ok(review.id)
})

test('POST /api/reviews (unstaged) creates a review with status in_progress', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  writeFileSync(join(fixture.dir, 'a.txt'), 'v1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')
  writeFileSync(join(fixture.dir, 'a.txt'), 'v2\n')

  const db = createTestDatabase()
  const app = buildApp({ repositoryPath: fixture.dir, db })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'POST',
    url: '/api/reviews',
    payload: { sourceType: 'unstaged' }
  })

  assert.equal(response.statusCode, 201)
  const review = response.json()
  assert.equal(review.status, 'in_progress')
  assert.ok(review.id)
})

test('POST /api/reviews with an invalid sourceType returns 400', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  const db = createTestDatabase()
  const app = buildApp({ repositoryPath: fixture.dir, db })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'POST',
    url: '/api/reviews',
    payload: { sourceType: 'bogus' }
  })

  assert.equal(response.statusCode, 400)
})

test('GET /api/reviews lists created reviews, newest first', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  await stageOneChange(fixture.dir, fixture.git)

  const db = createTestDatabase()
  const app = buildApp({ repositoryPath: fixture.dir, db })
  t.after(async () => {
    await app.close()
  })

  const first = await app.inject({
    method: 'POST',
    url: '/api/reviews',
    payload: { sourceType: 'staged' }
  })
  const second = await app.inject({
    method: 'POST',
    url: '/api/reviews',
    payload: { sourceType: 'staged' }
  })

  const list = await app.inject({ method: 'GET', url: '/api/reviews' })

  assert.equal(list.statusCode, 200)
  const reviews = list.json()
  assert.equal(reviews.length, 2)
  assert.equal(reviews[0].id, second.json().id)
  assert.equal(reviews[1].id, first.json().id)
})

test('GET /api/reviews/:id returns the review, and 404 for an unknown id', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  await stageOneChange(fixture.dir, fixture.git)

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
  const id = created.json().id

  const found = await app.inject({ method: 'GET', url: `/api/reviews/${id}` })
  assert.equal(found.statusCode, 200)
  assert.equal(found.json().id, id)

  const missing = await app.inject({
    method: 'GET',
    url: '/api/reviews/does-not-exist'
  })
  assert.equal(missing.statusCode, 404)
})

test('PATCH /api/reviews/:id updates the status and persists it', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  await stageOneChange(fixture.dir, fixture.git)

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
  const id = created.json().id

  const patched = await app.inject({
    method: 'PATCH',
    url: `/api/reviews/${id}`,
    payload: { status: 'approved' }
  })
  assert.equal(patched.statusCode, 200)
  assert.equal(patched.json().status, 'approved')

  const refetched = await app.inject({
    method: 'GET',
    url: `/api/reviews/${id}`
  })
  assert.equal(refetched.json().status, 'approved')
})

test('reviews persist across a server restart when using a file-backed database', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  await stageOneChange(fixture.dir, fixture.git)

  const { createFileDatabase } = await import('../../../src/server/db/index.ts')
  const dbPath = join(fixture.dir, '.githuman-test', 'reviews.db')

  const db1 = createFileDatabase(dbPath)
  const app1 = buildApp({ repositoryPath: fixture.dir, db: db1 })
  const created = await app1.inject({
    method: 'POST',
    url: '/api/reviews',
    payload: { sourceType: 'staged' }
  })
  const id = created.json().id
  await app1.close()
  db1.close()

  const db2 = createFileDatabase(dbPath)
  const app2 = buildApp({ repositoryPath: fixture.dir, db: db2 })
  t.after(async () => {
    await app2.close()
    db2.close()
  })

  const found = await app2.inject({ method: 'GET', url: `/api/reviews/${id}` })
  assert.equal(found.statusCode, 200)
  assert.equal(found.json().id, id)
})

test('DELETE /api/reviews/:id removes the review and its comments', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  await stageOneChange(fixture.dir, fixture.git)

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
  const id = created.json().id
  await app.inject({
    method: 'POST',
    url: `/api/reviews/${id}/comments`,
    payload: { filePath: 'a.txt', content: 'hi' }
  })

  const response = await app.inject({
    method: 'DELETE',
    url: `/api/reviews/${id}`
  })
  assert.equal(response.statusCode, 204)

  const refetched = await app.inject({
    method: 'GET',
    url: `/api/reviews/${id}`
  })
  assert.equal(refetched.statusCode, 404)
})

test('DELETE /api/reviews/:id for an unknown id returns 404', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  const db = createTestDatabase()
  const app = buildApp({ repositoryPath: fixture.dir, db })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'DELETE',
    url: '/api/reviews/does-not-exist'
  })
  assert.equal(response.statusCode, 404)
})
