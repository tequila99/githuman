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

test('GET /api/diff/:source/files lists staged and unstaged files with counts and no hunks', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'one\ntwo\n')
  writeFileSync(join(fixture.dir, 'b.txt'), 'x\n')
  await fixture.git.add(['a.txt', 'b.txt'])
  await fixture.git.commit('base')
  writeFileSync(join(fixture.dir, 'a.txt'), 'one\ntwo\nthree\n')
  await fixture.git.add('a.txt')
  writeFileSync(join(fixture.dir, 'b.txt'), 'y\n')
  writeFileSync(join(fixture.dir, 'new.txt'), 'n1\nn2\n')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const staged = (
    await app.inject({ method: 'GET', url: '/api/diff/staged/files' })
  ).json()
  assert.equal(staged.length, 1)
  assert.equal(staged[0].newPath, 'a.txt')
  assert.equal(staged[0].additions, 1)
  assert.equal(staged[0].deletions, 0)
  assert.equal('hunks' in staged[0], false)

  const unstaged = (
    await app.inject({ method: 'GET', url: '/api/diff/unstaged/files' })
  ).json()
  const byPath = Object.fromEntries(
    unstaged.map((f: { newPath: string }) => [f.newPath, f])
  )
  assert.deepEqual(Object.keys(byPath).sort(), ['b.txt', 'new.txt'])
  assert.equal(byPath['b.txt'].additions, 1)
  assert.equal(byPath['b.txt'].deletions, 1)
  assert.equal(byPath['new.txt'].status, 'added')
  assert.equal(byPath['new.txt'].additions, 2)
})

test('the signature of a file changes with its content, even at equal counts', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'v1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('base')
  writeFileSync(join(fixture.dir, 'a.txt'), 'v2\n')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })
  const read = async () =>
    (
      await app.inject({ method: 'GET', url: '/api/diff/unstaged/files' })
    ).json()[0].signature
  const first = await read()
  assert.equal(await read(), first)

  await new Promise(resolve => setTimeout(resolve, 20))
  writeFileSync(join(fixture.dir, 'a.txt'), 'v3\n')
  assert.notEqual(await read(), first)

  await fixture.git.add('a.txt')
  const stagedFirst = (
    await app.inject({ method: 'GET', url: '/api/diff/staged/files' })
  ).json()[0].signature
  writeFileSync(join(fixture.dir, 'a.txt'), 'v4\n')
  await fixture.git.add('a.txt')
  const stagedSecond = (
    await app.inject({ method: 'GET', url: '/api/diff/staged/files' })
  ).json()[0].signature
  assert.notEqual(stagedFirst, stagedSecond)
})

test('GET /api/diff/:source/files reports a rename with both paths', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'old.txt'), 'a\nb\nc\nd\n')
  await fixture.git.add('old.txt')
  await fixture.git.commit('base')
  await fixture.git.mv('old.txt', 'new.txt')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const files = (
    await app.inject({ method: 'GET', url: '/api/diff/staged/files' })
  ).json()
  assert.equal(files.length, 1)
  assert.equal(files[0].status, 'renamed')
  assert.equal(files[0].oldPath, 'old.txt')
  assert.equal(files[0].newPath, 'new.txt')
})

test('GET /api/diff/:source/file returns the hunks of one file', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'one\ntwo\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('base')
  writeFileSync(join(fixture.dir, 'a.txt'), 'one\nTWO\n')
  writeFileSync(join(fixture.dir, 'u.txt'), 'u\n')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const tracked = (
    await app.inject({
      method: 'GET',
      url: '/api/diff/unstaged/file?path=a.txt&status=modified'
    })
  ).json()
  assert.equal(tracked.additions, 1)
  assert.equal(tracked.deletions, 1)
  assert.equal(tracked.hunks.length, 1)

  const untracked = (
    await app.inject({
      method: 'GET',
      url: '/api/diff/unstaged/file?path=u.txt&status=added'
    })
  ).json()
  assert.equal(untracked.additions, 1)
  assert.equal(untracked.status, 'added')
})

test('GET /api/diff/:source/files rejects an unknown source', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'GET',
    url: '/api/diff/other/files'
  })
  assert.equal(response.statusCode, 400)
})

test('GET /api/diff/:source/file rejects a path outside the repository', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  for (const query of [
    'path=../outside.txt&status=modified',
    'path=a.txt&oldPath=../outside.txt&status=renamed'
  ]) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/diff/unstaged/file?${query}`
    })
    assert.equal(response.statusCode, 400, query)
  }
})
