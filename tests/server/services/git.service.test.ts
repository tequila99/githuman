import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTempGitRepo } from '../helpers/git-fixture.ts'
import {
  getFileAtRef,
  getFilesAtRef,
  getFilesAtRefBatch,
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

test('getFilesAtRefBatch matches getFileAtRef for each request, in request order', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'hello\n')
  writeFileSync(join(fixture.dir, 'b.txt'), 'world\n')
  writeFileSync(join(fixture.dir, 'c.txt'), 'third\n')
  await fixture.git.add(['a.txt', 'b.txt', 'c.txt'])
  await fixture.git.commit('add three files')

  const requests = [
    { ref: 'HEAD', path: 'c.txt' },
    { ref: 'HEAD', path: 'a.txt' },
    { ref: 'HEAD', path: 'b.txt' }
  ]

  const batched = await getFilesAtRefBatch(fixture.dir, requests)
  const individually = await Promise.all(
    requests.map(({ ref, path }) => getFileAtRef(fixture.dir, ref, path))
  )

  assert.deepEqual(batched, individually)
  assert.equal(batched[0].content, 'third\n')
  assert.equal(batched[1].content, 'hello\n')
  assert.equal(batched[2].content, 'world\n')
})

test('getFilesAtRefBatch resolves each entry against its own ref (HEAD and INDEX mixed in one call)', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'hello\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  writeFileSync(join(fixture.dir, 'a.txt'), 'hello\nworld\n')
  await fixture.git.add('a.txt')

  const [atHead, atIndex] = await getFilesAtRefBatch(fixture.dir, [
    { ref: 'HEAD', path: 'a.txt' },
    { ref: 'INDEX', path: 'a.txt' }
  ])

  assert.equal(atHead.content, 'hello\n')
  assert.equal(atIndex.content, 'hello\nworld\n')
})

test('getFilesAtRefBatch returns empty content for a path missing at that ref, without failing the rest of the batch', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'hello\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  writeFileSync(join(fixture.dir, 'b.txt'), 'new file\n')
  await fixture.git.add('b.txt')

  const [missing, present] = await getFilesAtRefBatch(fixture.dir, [
    { ref: 'HEAD', path: 'b.txt' },
    { ref: 'HEAD', path: 'a.txt' }
  ])

  assert.equal(missing.content, '')
  assert.equal(missing.isBinary, false)
  assert.equal(present.content, 'hello\n')
})

test('getFilesAtRefBatch flags binary content the same way getFileAtRef does', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  const binaryBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x00, 0xff
  ])
  writeFileSync(join(fixture.dir, 'image.png'), binaryBuffer)
  await fixture.git.add('image.png')

  const [result] = await getFilesAtRefBatch(fixture.dir, [
    { ref: 'INDEX', path: 'image.png' }
  ])

  assert.equal(result.isBinary, true)
  assert.equal(result.content, '')
})

test('getFilesAtRefBatch reads multi-line content byte-for-byte, parsing by announced size rather than by line', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`)
  const content = lines.join('\n') + '\n'
  writeFileSync(join(fixture.dir, 'big.txt'), content)
  await fixture.git.add('big.txt')
  await fixture.git.commit('add big.txt')

  const [result] = await getFilesAtRefBatch(fixture.dir, [
    { ref: 'HEAD', path: 'big.txt' }
  ])

  assert.equal(result.content, content)
})

test('getFilesAtRefBatch resolves duplicate (ref, path) requests independently, at their own positions', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'hello\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  const results = await getFilesAtRefBatch(fixture.dir, [
    { ref: 'HEAD', path: 'a.txt' },
    { ref: 'HEAD', path: 'a.txt' }
  ])

  assert.equal(results.length, 2)
  assert.deepEqual(results[0], results[1])
  assert.equal(results[0].content, 'hello\n')
})

test('getFilesAtRefBatch returns an empty array for an empty request list, without spawning git', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  const result = await getFilesAtRefBatch(fixture.dir, [])

  assert.deepEqual(result, [])
})

test("getFilesAtRefBatch rejects ref 'WORKTREE' rather than silently treating it as a git object", async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  await assert.rejects(
    getFilesAtRefBatch(fixture.dir, [{ ref: 'WORKTREE', path: 'a.txt' }])
  )
})

test('getFilesAtRefBatch rejects a ref starting with "-" instead of passing it to git', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  await assert.rejects(
    getFilesAtRefBatch(fixture.dir, [
      { ref: '--output=/tmp/pwned', path: 'a.txt' }
    ])
  )
})

test('getFilesAtRefBatch rejects when the underlying git process exits non-zero (not a git repository) — the failure buildDiffFiles falls back on', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const notARepo = mkdtempSync(join(tmpdir(), 'githuman-not-a-repo-'))
  t.after(() => rmSync(notARepo, { recursive: true, force: true }))

  await assert.rejects(
    getFilesAtRefBatch(notARepo, [{ ref: 'HEAD', path: 'a.txt' }])
  )
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
