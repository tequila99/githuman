import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTempGitRepo } from '../helpers/git-fixture.ts'
import {
  computeFileDiff,
  getStagedDiff,
  getUnstagedDiff,
  getBranchDiff,
  getCommitsDiff
} from '../../../src/server/services/diff.service.ts'

test('computeFileDiff: added file — all lines are "added", no old line numbers', () => {
  const result = computeFileDiff('', 'line1\nline2\n', {
    oldPath: 'new.txt',
    newPath: 'new.txt',
    status: 'added',
    isBinary: false
  })

  assert.equal(result.additions, 2)
  assert.equal(result.deletions, 0)
  assert.equal(result.hunks.length, 1)
  const lines = result.hunks[0].lines
  assert.equal(lines.length, 2)
  for (const line of lines) {
    assert.equal(line.type, 'added')
    assert.equal(line.oldLineNumber, null)
  }
  assert.equal(lines[0].newLineNumber, 1)
  assert.equal(lines[1].newLineNumber, 2)
})

test('computeFileDiff: deleted file — all lines are "removed", no new line numbers', () => {
  const result = computeFileDiff('line1\nline2\n', '', {
    oldPath: 'gone.txt',
    newPath: 'gone.txt',
    status: 'deleted',
    isBinary: false
  })

  assert.equal(result.additions, 0)
  assert.equal(result.deletions, 2)
  const lines = result.hunks[0].lines
  assert.equal(lines.length, 2)
  for (const line of lines) {
    assert.equal(line.type, 'removed')
    assert.equal(line.newLineNumber, null)
  }
  assert.equal(lines[0].oldLineNumber, 1)
  assert.equal(lines[1].oldLineNumber, 2)
})

test('computeFileDiff: modified file — context lines keep both old and new line numbers', () => {
  const result = computeFileDiff('a\nb\nc\n', 'a\nX\nc\n', {
    oldPath: 'file.txt',
    newPath: 'file.txt',
    status: 'modified',
    isBinary: false
  })

  assert.equal(result.additions, 1)
  assert.equal(result.deletions, 1)

  const lines = result.hunks[0].lines
  const byType = (t: string) => lines.filter(l => l.type === t)

  assert.equal(byType('context').length, 2)
  assert.equal(byType('removed').length, 1)
  assert.equal(byType('added').length, 1)

  const removed = byType('removed')[0]
  assert.equal(removed.content, 'b')
  assert.equal(removed.oldLineNumber, 2)
  assert.equal(removed.newLineNumber, null)

  const added = byType('added')[0]
  assert.equal(added.content, 'X')
  assert.equal(added.newLineNumber, 2)
  assert.equal(added.oldLineNumber, null)
})

test('computeFileDiff: pure rename (unchanged content) produces no hunks', () => {
  const result = computeFileDiff('same\n', 'same\n', {
    oldPath: 'old-name.txt',
    newPath: 'new-name.txt',
    status: 'renamed',
    isBinary: false
  })

  assert.equal(result.hunks.length, 0)
  assert.equal(result.additions, 0)
  assert.equal(result.deletions, 0)
  assert.equal(result.oldPath, 'old-name.txt')
  assert.equal(result.newPath, 'new-name.txt')
})

test('computeFileDiff: binary files produce no hunks regardless of content', () => {
  const result = computeFileDiff('', '', {
    oldPath: 'image.png',
    newPath: 'image.png',
    status: 'modified',
    isBinary: true
  })

  assert.equal(result.isBinary, true)
  assert.equal(result.hunks.length, 0)
})

function repeatLines(prefix: string, count: number): string {
  let out = ''
  for (let i = 1; i <= count; i++) out += `${prefix}${i}\n`
  return out
}

test('computeFileDiff: a change in the middle of a large file windows context to 3 lines, not the whole file', () => {
  const oldContent = repeatLines('line', 40)
  const lines = oldContent.split('\n')
  lines[19] = 'CHANGED'
  const newContent = lines.join('\n')

  const result = computeFileDiff(oldContent, newContent, {
    oldPath: 'big.txt',
    newPath: 'big.txt',
    status: 'modified',
    isBinary: false
  })

  assert.equal(result.hunks.length, 1)
  const hunk = result.hunks[0]
  assert.ok(
    hunk.lines.length < 40,
    `expected windowed hunk, got ${hunk.lines.length} lines`
  )
  const contextBefore = hunk.lines.filter(
    l => l.type === 'context' && (l.oldLineNumber ?? 0) < 20
  )
  const contextAfter = hunk.lines.filter(
    l => l.type === 'context' && (l.oldLineNumber ?? 0) > 20
  )
  assert.equal(contextBefore.length, 3)
  assert.equal(contextAfter.length, 3)
})

test('computeFileDiff: two changes far apart produce two separate hunks', () => {
  const oldContent = repeatLines('line', 40)
  const lines = oldContent.split('\n')
  lines[4] = 'CHANGED_A'
  lines[34] = 'CHANGED_B'
  const newContent = lines.join('\n')

  const result = computeFileDiff(oldContent, newContent, {
    oldPath: 'big.txt',
    newPath: 'big.txt',
    status: 'modified',
    isBinary: false
  })

  assert.equal(result.hunks.length, 2)
  assert.ok(result.hunks[0].lines.some(l => l.content === 'CHANGED_A'))
  assert.ok(result.hunks[1].lines.some(l => l.content === 'CHANGED_B'))
  assert.equal(result.hunks[0].oldStart, 2)
  assert.equal(result.hunks[1].oldStart, 32)
})

test('computeFileDiff: two changes close together stay in one hunk with context between them', () => {
  const oldContent = repeatLines('line', 20)
  const lines = oldContent.split('\n')
  lines[9] = 'CHANGED_A'
  lines[13] = 'CHANGED_B'
  const newContent = lines.join('\n')

  const result = computeFileDiff(oldContent, newContent, {
    oldPath: 'big.txt',
    newPath: 'big.txt',
    status: 'modified',
    isBinary: false
  })

  assert.equal(result.hunks.length, 1)
  assert.ok(result.hunks[0].lines.some(l => l.content === 'CHANGED_A'))
  assert.ok(result.hunks[0].lines.some(l => l.content === 'CHANGED_B'))
})

test('computeFileDiff: change at the very start of the file does not run off the edge', () => {
  const oldContent = repeatLines('line', 20)
  const lines = oldContent.split('\n')
  lines[0] = 'CHANGED'
  const newContent = lines.join('\n')

  const result = computeFileDiff(oldContent, newContent, {
    oldPath: 'big.txt',
    newPath: 'big.txt',
    status: 'modified',
    isBinary: false
  })

  assert.equal(result.hunks.length, 1)
  assert.equal(result.hunks[0].oldStart, 1)
  assert.ok(result.hunks[0].lines.some(l => l.content === 'CHANGED'))
})

test('computeFileDiff: change at the very end of the file does not run off the edge', () => {
  const oldContent = repeatLines('line', 20)
  const lines = oldContent.split('\n')
  lines[19] = 'CHANGED'
  const newContent = lines.join('\n')

  const result = computeFileDiff(oldContent, newContent, {
    oldPath: 'big.txt',
    newPath: 'big.txt',
    status: 'modified',
    isBinary: false
  })

  assert.equal(result.hunks.length, 1)
  assert.ok(result.hunks[0].lines.some(l => l.content === 'CHANGED'))
  assert.equal(
    result.hunks[0].lines[result.hunks[0].lines.length - 1].content,
    'CHANGED'
  )
})

test('computeFileDiff: an added file with no old lines produces oldStart 0', () => {
  const result = computeFileDiff('', 'a\nb\n', {
    oldPath: 'new.txt',
    newPath: 'new.txt',
    status: 'added',
    isBinary: false
  })

  assert.equal(result.hunks[0].oldStart, 0)
  assert.equal(result.hunks[0].oldLines, 0)
})

test('getStagedDiff returns diff for staged changes against HEAD', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'v1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  writeFileSync(join(fixture.dir, 'a.txt'), 'v2\n')
  await fixture.git.add('a.txt')

  const files = await getStagedDiff(fixture.dir)

  assert.equal(files.length, 1)
  assert.equal(files[0].newPath, 'a.txt')
  assert.equal(files[0].status, 'modified')
  assert.equal(files[0].additions, 1)
  assert.equal(files[0].deletions, 1)
})

test('getStagedDiff returns an empty array when nothing is staged', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'v1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  const files = await getStagedDiff(fixture.dir)

  assert.deepEqual(files, [])
})

test('getBranchDiff returns diff between the current branch and a base ref', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'file.txt'), 'base\n')
  await fixture.git.add('file.txt')
  await fixture.git.commit('base commit')

  await fixture.git.checkoutLocalBranch('feature')
  writeFileSync(join(fixture.dir, 'file.txt'), 'feature\n')
  await fixture.git.add('file.txt')
  await fixture.git.commit('feature change')

  const files = await getBranchDiff(fixture.dir, 'main')

  assert.equal(files.length, 1)
  assert.equal(files[0].newPath, 'file.txt')
  assert.equal(
    files[0].hunks[0].lines.some(
      l => l.type === 'added' && l.content === 'feature'
    ),
    true
  )
})

test('getBranchDiff rejects a base ref starting with "-" instead of passing it to git', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  await assert.rejects(getBranchDiff(fixture.dir, '--output=/tmp/pwned'))
})

test('getCommitsDiff rejects a from/to ref starting with "-" instead of passing it to git', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  await assert.rejects(
    getCommitsDiff(fixture.dir, '--output=/tmp/pwned', 'HEAD')
  )
  await assert.rejects(
    getCommitsDiff(fixture.dir, 'HEAD', '--output=/tmp/pwned')
  )
})

test('getCommitsDiff returns diff between two arbitrary commits', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'file.txt'), 'first\n')
  await fixture.git.add('file.txt')
  await fixture.git.commit('first commit')
  const first = (await fixture.git.revparse(['HEAD'])).trim()

  writeFileSync(join(fixture.dir, 'file.txt'), 'second\n')
  await fixture.git.add('file.txt')
  await fixture.git.commit('second commit')
  const second = (await fixture.git.revparse(['HEAD'])).trim()

  const files = await getCommitsDiff(fixture.dir, first, second)

  assert.equal(files.length, 1)
  assert.equal(files[0].newPath, 'file.txt')
  assert.equal(files[0].additions, 1)
  assert.equal(files[0].deletions, 1)
})

test('getStagedDiff: newly added staged file is reported with status "added"', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'existing.txt'), 'x\n')
  await fixture.git.add('existing.txt')
  await fixture.git.commit('initial')

  writeFileSync(join(fixture.dir, 'new.txt'), 'hello\n')
  await fixture.git.add('new.txt')

  const files = await getStagedDiff(fixture.dir)

  assert.equal(files.length, 1)
  assert.equal(files[0].status, 'added')
  assert.equal(
    files[0].hunks[0].lines.every(l => l.type === 'added'),
    true
  )
})

test('getStagedDiff: staged deletion of a tracked file is reported with status "deleted"', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'doomed.txt'), 'bye\n')
  await fixture.git.add('doomed.txt')
  await fixture.git.commit('initial')

  await fixture.git.rm('doomed.txt')

  const files = await getStagedDiff(fixture.dir)

  assert.equal(files.length, 1)
  assert.equal(files[0].status, 'deleted')
  assert.equal(
    files[0].hunks[0].lines.every(l => l.type === 'removed'),
    true
  )
})

test('getStagedDiff: staged binary file change does not throw and is marked isBinary', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(
    join(fixture.dir, 'image.png'),
    Buffer.from([0x00, 0x01, 0x02, 0xff])
  )
  await fixture.git.add('image.png')

  const files = await getStagedDiff(fixture.dir)

  assert.equal(files.length, 1)
  assert.equal(files[0].isBinary, true)
  assert.deepEqual(files[0].hunks, [])
})

test('getUnstagedDiff: a tracked file edited but not staged is reported as "modified"', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'v1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  writeFileSync(join(fixture.dir, 'a.txt'), 'v2\n')

  const files = await getUnstagedDiff(fixture.dir)

  assert.equal(files.length, 1)
  assert.equal(files[0].newPath, 'a.txt')
  assert.equal(files[0].status, 'modified')
})

test('getUnstagedDiff: an untracked new file is reported as "added"', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'v1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  writeFileSync(join(fixture.dir, 'new-file.txt'), 'brand new\nsecond line\n')

  const files = await getUnstagedDiff(fixture.dir)

  assert.equal(files.length, 1)
  assert.equal(files[0].newPath, 'new-file.txt')
  assert.equal(files[0].status, 'added')
  assert.equal(files[0].additions, 2)
  for (const line of files[0].hunks[0].lines) {
    assert.equal(line.type, 'added')
    assert.equal(line.oldLineNumber, null)
  }
})

test('getUnstagedDiff: a fully staged file with no further edits does not appear', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'v1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  writeFileSync(join(fixture.dir, 'a.txt'), 'v2\n')
  await fixture.git.add('a.txt')

  const files = await getUnstagedDiff(fixture.dir)

  assert.deepEqual(files, [])
})

test('getUnstagedDiff returns an empty array when there is nothing unstaged or untracked', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'v1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  const files = await getUnstagedDiff(fixture.dir)

  assert.deepEqual(files, [])
})

test('getUnstagedDiff: an untracked binary file does not throw and is marked isBinary', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  writeFileSync(join(fixture.dir, 'a.txt'), 'v1\n')
  await fixture.git.add('a.txt')
  await fixture.git.commit('add a.txt')

  writeFileSync(
    join(fixture.dir, 'image.png'),
    Buffer.from([0x00, 0x01, 0x02, 0xff])
  )

  const files = await getUnstagedDiff(fixture.dir)

  assert.equal(files.length, 1)
  assert.equal(files[0].isBinary, true)
  assert.deepEqual(files[0].hunks, [])
})
