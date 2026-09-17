import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTempGitRepo } from '../helpers/git-fixture.ts'
import { buildApp } from '../../../src/server/app.ts'

test('GET /api/git/info returns repository name, branch, remote and path', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({ method: 'GET', url: '/api/git/info' })

  assert.equal(response.statusCode, 200)
  const info = response.json()
  assert.equal(info.branch, 'main')
  assert.equal(info.path, fixture.dir)
})

test('POST /api/git/stage with paths stages exactly those files', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('initial')
  writeFileSync(join(fixture.dir, 'a.txt'), 'a2\n')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'POST',
    url: '/api/git/stage',
    payload: { paths: ['a.txt'] }
  })

  assert.equal(response.statusCode, 200)
  const status = await fixture.git.status()
  assert.deepEqual(status.staged, ['a.txt'])
})

test('POST /api/git/stage with no paths stages everything', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('initial')
  writeFileSync(join(fixture.dir, 'a.txt'), 'a2\n')
  writeFileSync(join(fixture.dir, 'new.txt'), 'brand new\n')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'POST',
    url: '/api/git/stage',
    payload: {}
  })

  assert.equal(response.statusCode, 200)
  const status = await fixture.git.status()
  assert.deepEqual(status.staged.sort(), ['a.txt', 'new.txt'])
})

test('POST /api/git/unstage with paths unstages exactly those files', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a1\n')
  writeFileSync(join(fixture.dir, 'b.txt'), 'b1\n')
  await fixture.git.add(['a.txt', 'b.txt'])
  await fixture.git.commit('initial')
  writeFileSync(join(fixture.dir, 'a.txt'), 'a2\n')
  writeFileSync(join(fixture.dir, 'b.txt'), 'b2\n')
  await fixture.git.add(['a.txt', 'b.txt'])

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'POST',
    url: '/api/git/unstage',
    payload: { paths: ['a.txt'] }
  })

  assert.equal(response.statusCode, 200)
  const status = await fixture.git.status()
  assert.deepEqual(status.staged, ['b.txt'])
})

test('POST /api/git/unstage with no paths unstages everything', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('initial')
  writeFileSync(join(fixture.dir, 'a.txt'), 'a2\n')
  await fixture.git.add('a.txt')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'POST',
    url: '/api/git/unstage',
    payload: {}
  })

  assert.equal(response.statusCode, 200)
  const status = await fixture.git.status()
  assert.deepEqual(status.staged, [])
})

test('POST /api/git/discard discards a tracked modified file back to its last-staged content', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'original\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('initial')
  writeFileSync(join(fixture.dir, 'a.txt'), 'unstaged edit\n')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'POST',
    url: '/api/git/discard',
    payload: { paths: ['a.txt'] }
  })

  assert.equal(response.statusCode, 200)
  const status = await fixture.git.status()
  assert.deepEqual(status.modified, [])
})

test('POST /api/git/discard deletes an untracked file', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('initial')
  writeFileSync(join(fixture.dir, 'new.txt'), 'brand new\n')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'POST',
    url: '/api/git/discard',
    payload: { paths: ['new.txt'] }
  })

  assert.equal(response.statusCode, 200)
  assert.equal(existsSync(join(fixture.dir, 'new.txt')), false)
})

test('POST /api/git/discard with an empty paths array returns 400', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('initial')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'POST',
    url: '/api/git/discard',
    payload: { paths: [] }
  })

  assert.equal(response.statusCode, 400)
})

test('GET /api/git/tree/:ref lists files at that ref', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('initial')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'GET',
    url: '/api/git/tree/HEAD'
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { ref: 'HEAD', files: ['a.txt'] })
})

test('GET /api/git/tree/:ref with WORKTREE also lists untracked files', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('initial')
  writeFileSync(join(fixture.dir, 'new.txt'), 'brand new\n')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'GET',
    url: '/api/git/tree/WORKTREE'
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json().files, ['a.txt', 'new.txt'])
})

test('GET /api/git/tree/:ref with an invalid ref returns 400', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('initial')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'GET',
    url: '/api/git/tree/not-a-real-ref'
  })

  assert.equal(response.statusCode, 400)
})

test('GET /api/git/file/* returns content, lines and isBinary for a file at a ref', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'line1\nline2\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('initial')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'GET',
    url: '/api/git/file/a.txt?ref=HEAD'
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    path: 'a.txt',
    ref: 'HEAD',
    content: 'line1\nline2\n',
    lines: ['line1', 'line2', ''],
    lineCount: 3,
    isBinary: false
  })
})

test('GET /api/git/file/* with ref=WORKTREE reads the file directly off disk', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'committed\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('initial')
  writeFileSync(join(fixture.dir, 'a.txt'), 'unstaged edit\n')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'GET',
    url: '/api/git/file/a.txt?ref=WORKTREE'
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().content, 'unstaged edit\n')
})

test('GET /api/git/file/* on a nested path resolves the full path from the wildcard', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  mkdirSync(join(fixture.dir, 'src'))
  writeFileSync(join(fixture.dir, 'src', 'index.ts'), 'export {}\n')
  await fixture.git.add('src/index.ts')
  await fixture.git.commit('initial')

  const app = buildApp({ repositoryPath: fixture.dir })
  t.after(async () => {
    await app.close()
  })

  const response = await app.inject({
    method: 'GET',
    url: '/api/git/file/src/index.ts?ref=HEAD'
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().path, 'src/index.ts')
})
