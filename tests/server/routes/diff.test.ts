import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTempGitRepo } from '../helpers/git-fixture.ts'
import { buildApp } from '../../../src/server/app.ts'

test('GET /api/diff/staged returns the current staged diff', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'v1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')
  writeFileSync(join(fixture.dir, 'a.txt'), 'v2\n')
  await fixture.git.add('a.txt')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({ method: 'GET', url: '/api/diff/staged' })

  assert.equal(response.statusCode, 200)
  const files = response.json()
  assert.equal(files.length, 1)
  assert.equal(files[0].newPath, 'a.txt')
})

test('GET /api/diff/staged returns [] when the repository has no commits and nothing staged', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({ method: 'GET', url: '/api/diff/staged' })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), [])
})

test('GET /api/diff/unstaged returns unstaged tracked edits plus untracked new files', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'v1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')
  writeFileSync(join(fixture.dir, 'a.txt'), 'v2\n')
  writeFileSync(join(fixture.dir, 'new-file.txt'), 'brand new\n')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'GET',
    url: '/api/diff/unstaged'
  })

  assert.equal(response.statusCode, 200)
  const files = response.json()
  const byPath = Object.fromEntries(
    files.map((f: { newPath: string }) => [f.newPath, f])
  )
  assert.equal(byPath['a.txt'].status, 'modified')
  assert.equal(byPath['new-file.txt'].status, 'added')
})

test('GET /api/diff/unstaged returns [] when there is nothing unstaged or untracked', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'v1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'GET',
    url: '/api/diff/unstaged'
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), [])
})

test('GET /api/diff/branch returns the diff against the given base', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'file.txt'), 'base\n')
  await fixture.git.add('file.txt')
  await fixture.git.commit('base commit')
  await fixture.git.checkoutLocalBranch('feature')
  writeFileSync(join(fixture.dir, 'file.txt'), 'feature\n')
  await fixture.git.add('file.txt')
  await fixture.git.commit('feature change')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'GET',
    url: '/api/diff/branch?base=main'
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().length, 1)
})

test('GET /api/diff/branch without "base" returns 400', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({ method: 'GET', url: '/api/diff/branch' })

  assert.equal(response.statusCode, 400)
})

test('GET /api/diff/commits returns the diff between two commits', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'file.txt'), 'first\n')
  await fixture.git.add('file.txt')
  await fixture.git.commit('first')
  const from = (await fixture.git.revparse(['HEAD'])).trim()

  writeFileSync(join(fixture.dir, 'file.txt'), 'second\n')
  await fixture.git.add('file.txt')
  await fixture.git.commit('second')
  const to = (await fixture.git.revparse(['HEAD'])).trim()

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'GET',
    url: `/api/diff/commits?from=${from}&to=${to}`
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().length, 1)
})

test('GET /api/diff/commits without "from"/"to" returns 400', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({ method: 'GET', url: '/api/diff/commits' })

  assert.equal(response.statusCode, 400)
})
