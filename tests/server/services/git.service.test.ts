import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTempGitRepo } from '../helpers/git-fixture.ts'
import {
  getFileAtRef,
  getFilesAtRef,
  listChangedPaths,
  listUntrackedPaths,
  getRepositoryInfo,
  stagePaths,
  unstagePaths,
  discardPaths,
  assertSafeRef
} from '../../../src/server/services/git.service.ts'

test('getFileAtRef reads committed content at HEAD', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'hello\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  const result = await getFileAtRef(fixture.dir, 'HEAD', 'a.txt')

  assert.equal(result.content, 'hello\n')
  assert.equal(result.isBinary, false)
})

test('getFileAtRef reads staged (INDEX) content, distinct from HEAD', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'hello\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  writeFileSync(join(fixture.dir, 'a.txt'), 'hello\nworld\n')
  await fixture.git.add('a.txt')

  const atHead = await getFileAtRef(fixture.dir, 'HEAD', 'a.txt')
  const atIndex = await getFileAtRef(fixture.dir, 'INDEX', 'a.txt')

  assert.equal(atHead.content, 'hello\n')
  assert.equal(atIndex.content, 'hello\nworld\n')
})

test('getFileAtRef returns empty content for a path that does not exist at that ref', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'hello\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  writeFileSync(join(fixture.dir, 'b.txt'), 'new file\n')
  await fixture.git.add('b.txt')

  const atHead = await getFileAtRef(fixture.dir, 'HEAD', 'b.txt')

  assert.equal(atHead.content, '')
  assert.equal(atHead.isBinary, false)
})

test('getFileAtRef flags binary content without attempting to decode it as text', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  const binaryBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x00, 0xff
  ])
  writeFileSync(join(fixture.dir, 'image.png'), binaryBuffer)
  await fixture.git.add('image.png')

  const result = await getFileAtRef(fixture.dir, 'INDEX', 'image.png')

  assert.equal(result.isBinary, true)
})

test("getFileAtRef('WORKTREE', ...) reads the file directly off disk, including unstaged edits", async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'hello\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  writeFileSync(join(fixture.dir, 'a.txt'), 'hello\nunstaged edit\n')

  const worktree = await getFileAtRef(fixture.dir, 'WORKTREE', 'a.txt')
  const atIndex = await getFileAtRef(fixture.dir, 'INDEX', 'a.txt')

  assert.equal(worktree.content, 'hello\nunstaged edit\n')
  assert.equal(atIndex.content, 'hello\n')
})

test("getFileAtRef('WORKTREE', ...) flags a binary file on disk without decoding it", async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  const binaryBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x00, 0xff
  ])
  writeFileSync(join(fixture.dir, 'image.png'), binaryBuffer)

  const result = await getFileAtRef(fixture.dir, 'WORKTREE', 'image.png')

  assert.equal(result.isBinary, true)
})

test("getFilesAtRef('HEAD', ...) lists the files committed at that ref", async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a\n')
  writeFileSync(join(fixture.dir, 'b.txt'), 'b\n')
  await fixture.git.add(['a.txt', 'b.txt'])
  await fixture.git.commit('initial')

  writeFileSync(join(fixture.dir, 'untracked.txt'), 'new\n')

  const files = await getFilesAtRef(fixture.dir, 'HEAD')

  assert.deepEqual(files, ['a.txt', 'b.txt'])
})

test("getFilesAtRef('INDEX', ...) lists the staged snapshot, including a staged new file", async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('initial')

  writeFileSync(join(fixture.dir, 'staged-new.txt'), 'new\n')
  await fixture.git.add('staged-new.txt')
  writeFileSync(join(fixture.dir, 'untracked.txt'), 'not staged\n')

  const files = await getFilesAtRef(fixture.dir, 'INDEX')

  assert.deepEqual(files, ['a.txt', 'staged-new.txt'])
})

test("getFilesAtRef('WORKTREE', ...) lists tracked and untracked files, honoring .gitignore", async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a\n')
  writeFileSync(join(fixture.dir, '.gitignore'), 'ignored.txt\n')
  await fixture.git.add(['a.txt', '.gitignore'])
  await fixture.git.commit('initial')

  writeFileSync(join(fixture.dir, 'untracked.txt'), 'new\n')
  writeFileSync(join(fixture.dir, 'ignored.txt'), 'skip me\n')

  const files = await getFilesAtRef(fixture.dir, 'WORKTREE')

  assert.deepEqual(files, ['.gitignore', 'a.txt', 'untracked.txt'])
})

test('listUntrackedPaths lists new files never added to the index, ignoring tracked ones', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'tracked.txt'), 'v1\n')
  await fixture.git.add('tracked.txt')
  await fixture.git.commit('add tracked.txt')

  writeFileSync(join(fixture.dir, 'tracked.txt'), 'v2\n')
  writeFileSync(join(fixture.dir, 'new-file.txt'), 'brand new\n')

  const untracked = await listUntrackedPaths(fixture.dir)

  assert.deepEqual(untracked, ['new-file.txt'])
})

test('listUntrackedPaths returns an empty array when there is nothing untracked', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  const untracked = await listUntrackedPaths(fixture.dir)

  assert.deepEqual(untracked, [])
})

test('listChangedPaths (--cached) reports added/modified/deleted staged files with correct status', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'modified.txt'), 'v1\n')
  writeFileSync(join(fixture.dir, 'deleted.txt'), 'bye\n')
  await fixture.git.add(['modified.txt', 'deleted.txt'])
  await fixture.git.commit('initial')

  writeFileSync(join(fixture.dir, 'modified.txt'), 'v2\n')
  writeFileSync(join(fixture.dir, 'added.txt'), 'hi\n')
  await fixture.git.rm(['deleted.txt'])
  await fixture.git.add(['modified.txt', 'added.txt'])

  const changes = await listChangedPaths(fixture.dir, ['--cached'])
  const byPath = Object.fromEntries(changes.map(c => [c.newPath, c]))

  assert.equal(byPath['modified.txt'].status, 'modified')
  assert.equal(byPath['added.txt'].status, 'added')
  assert.equal(byPath['deleted.txt'].status, 'deleted')
})

test('listChangedPaths detects a pure rename with both old and new paths', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(
    join(fixture.dir, 'old-name.txt'),
    'same content\nwith enough lines\nto be detected as a rename\n'
  )
  await fixture.git.add('old-name.txt')
  await fixture.git.commit('add old-name.txt')

  await fixture.git.mv('old-name.txt', 'new-name.txt')

  const changes = await listChangedPaths(fixture.dir, ['--cached'])

  assert.equal(changes.length, 1)
  assert.equal(changes[0].status, 'renamed')
  assert.equal(changes[0].oldPath, 'old-name.txt')
  assert.equal(changes[0].newPath, 'new-name.txt')
})

test('listChangedPaths returns an empty array when there is nothing staged', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  const changes = await listChangedPaths(fixture.dir, ['--cached'])

  assert.deepEqual(changes, [])
})

test('getRepositoryInfo returns name, branch and remote', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')
  await fixture.git.addRemote('origin', 'https://example.com/repo.git')

  const info = await getRepositoryInfo(fixture.dir)

  assert.equal(info.branch, 'main')
  assert.equal(info.remote, 'https://example.com/repo.git')
  assert.equal(info.path, fixture.dir)
})

test('getRepositoryInfo returns null remote when there is none configured', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  const info = await getRepositoryInfo(fixture.dir)

  assert.equal(info.remote, null)
})

test('stagePaths stages exactly the given paths, leaving other unstaged changes alone', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a1\n')
  writeFileSync(join(fixture.dir, 'b.txt'), 'b1\n')
  await fixture.git.add(['a.txt', 'b.txt'])
  await fixture.git.commit('initial')

  writeFileSync(join(fixture.dir, 'a.txt'), 'a2\n')
  writeFileSync(join(fixture.dir, 'b.txt'), 'b2\n')

  await stagePaths(fixture.dir, ['a.txt'])

  const staged = await listChangedPaths(fixture.dir, ['--cached'])
  const unstaged = await listChangedPaths(fixture.dir, [])

  assert.deepEqual(
    staged.map(c => c.newPath),
    ['a.txt']
  )
  assert.deepEqual(
    unstaged.map(c => c.newPath),
    ['b.txt']
  )
})

test('stagePaths with no paths stages everything (tracked edits and untracked new files)', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('initial')

  writeFileSync(join(fixture.dir, 'a.txt'), 'a2\n')
  writeFileSync(join(fixture.dir, 'new.txt'), 'brand new\n')

  await stagePaths(fixture.dir, [])

  const staged = await listChangedPaths(fixture.dir, ['--cached'])
  const unstaged = await listChangedPaths(fixture.dir, [])
  const untracked = await listUntrackedPaths(fixture.dir)

  assert.deepEqual(staged.map(c => c.newPath).sort(), ['a.txt', 'new.txt'])
  assert.deepEqual(unstaged, [])
  assert.deepEqual(untracked, [])
})

test('unstagePaths unstages exactly the given paths, leaving other staged changes alone', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a1\n')
  writeFileSync(join(fixture.dir, 'b.txt'), 'b1\n')
  await fixture.git.add(['a.txt', 'b.txt'])
  await fixture.git.commit('initial')

  writeFileSync(join(fixture.dir, 'a.txt'), 'a2\n')
  writeFileSync(join(fixture.dir, 'b.txt'), 'b2\n')
  await fixture.git.add(['a.txt', 'b.txt'])

  await unstagePaths(fixture.dir, ['a.txt'])

  const staged = await listChangedPaths(fixture.dir, ['--cached'])
  const unstaged = await listChangedPaths(fixture.dir, [])

  assert.deepEqual(
    staged.map(c => c.newPath),
    ['b.txt']
  )
  assert.deepEqual(
    unstaged.map(c => c.newPath),
    ['a.txt']
  )
})

test('unstagePaths with no paths unstages everything', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a1\n')
  writeFileSync(join(fixture.dir, 'b.txt'), 'b1\n')
  await fixture.git.add(['a.txt', 'b.txt'])
  await fixture.git.commit('initial')

  writeFileSync(join(fixture.dir, 'a.txt'), 'a2\n')
  writeFileSync(join(fixture.dir, 'b.txt'), 'b2\n')
  await fixture.git.add(['a.txt', 'b.txt'])

  await unstagePaths(fixture.dir, [])

  const staged = await listChangedPaths(fixture.dir, ['--cached'])
  const unstaged = await listChangedPaths(fixture.dir, [])

  assert.deepEqual(staged, [])
  assert.deepEqual(unstaged.map(c => c.newPath).sort(), ['a.txt', 'b.txt'])
})

test('discardPaths restores a tracked modified file to its last-staged content', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'original\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('initial')

  writeFileSync(join(fixture.dir, 'a.txt'), 'unstaged edit\n')

  await discardPaths(fixture.dir, ['a.txt'])

  const content = await getFileAtRef(fixture.dir, 'WORKTREE', 'a.txt')
  assert.equal(content.content, 'original\n')
})

test('discardPaths restores a tracked deleted file', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'original\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('initial')

  unlinkSync(join(fixture.dir, 'a.txt'))
  assert.equal(existsSync(join(fixture.dir, 'a.txt')), false)

  await discardPaths(fixture.dir, ['a.txt'])

  assert.equal(existsSync(join(fixture.dir, 'a.txt')), true)
  const content = await getFileAtRef(fixture.dir, 'WORKTREE', 'a.txt')
  assert.equal(content.content, 'original\n')
})

test('discardPaths deletes an untracked new file', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('initial')

  writeFileSync(join(fixture.dir, 'new.txt'), 'brand new\n')

  await discardPaths(fixture.dir, ['new.txt'])

  assert.equal(existsSync(join(fixture.dir, 'new.txt')), false)
})

test('discardPaths handles a mix of tracked-modified, tracked-deleted, and untracked-new paths in one call', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'modified.txt'), 'v1\n')
  writeFileSync(join(fixture.dir, 'deleted.txt'), 'bye\n')
  await fixture.git.add(['modified.txt', 'deleted.txt'])
  await fixture.git.commit('initial')

  writeFileSync(join(fixture.dir, 'modified.txt'), 'v2\n')
  unlinkSync(join(fixture.dir, 'deleted.txt'))
  writeFileSync(join(fixture.dir, 'new.txt'), 'brand new\n')

  await discardPaths(fixture.dir, ['modified.txt', 'deleted.txt', 'new.txt'])

  assert.equal(
    (await getFileAtRef(fixture.dir, 'WORKTREE', 'modified.txt')).content,
    'v1\n'
  )
  assert.equal(existsSync(join(fixture.dir, 'deleted.txt')), true)
  assert.equal(existsSync(join(fixture.dir, 'new.txt')), false)
})

test('discardPaths does nothing when given an empty array', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'a1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('initial')
  writeFileSync(join(fixture.dir, 'a.txt'), 'a2\n')

  await discardPaths(fixture.dir, [])

  const content = await getFileAtRef(fixture.dir, 'WORKTREE', 'a.txt')
  assert.equal(content.content, 'a2\n')
})

test("getFileAtRef('WORKTREE', ...) refuses to read a path that escapes the repository root", async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  const result = await getFileAtRef(
    fixture.dir,
    'WORKTREE',
    '../../../../../../etc/passwd'
  )

  // Traversal is treated the same as "file does not exist" rather than
  // leaking content from outside the repository.
  assert.equal(result.content, '')
  assert.equal(result.isBinary, false)
})

test('assertSafeRef rejects a ref starting with "-" (git-option-shaped input)', () => {
  assert.throws(() => assertSafeRef('--output=/tmp/pwned'))
  assert.doesNotThrow(() => assertSafeRef('HEAD'))
  assert.doesNotThrow(() => assertSafeRef('main'))
})

test('getFileAtRef rejects a ref starting with "-" instead of passing it to git', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  await assert.rejects(
    getFileAtRef(fixture.dir, '--output=/tmp/pwned', 'a.txt')
  )
})

test('getFilesAtRef rejects a ref starting with "-" instead of passing it to git', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  await assert.rejects(getFilesAtRef(fixture.dir, '--output=/tmp/pwned'))
})
