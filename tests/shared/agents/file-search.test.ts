import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankPaths } from '../../../src/shared/agents/file-search.ts'

const FILES = [
  'README.md',
  'src/server/app.ts',
  'src/web/App.vue',
  'src/web/components/AppHeader.vue',
  'src/app/readme.md',
  'docs/application-notes.md',
  'tests/server/app.test.ts'
]

test('a file name beats a path match, exact beats prefix beats substring, ties go to the shorter path', () => {
  assert.deepEqual(rankPaths(FILES, 'app'), [
    'src/web/App.vue',
    'src/server/app.ts',
    'tests/server/app.test.ts',
    'docs/application-notes.md',
    'src/web/components/AppHeader.vue',
    'src/app/readme.md'
  ])
  assert.deepEqual(rankPaths(FILES, 'readme.md'), [
    'README.md',
    'src/app/readme.md'
  ])
})

test('matching ignores case and surrounding blanks; an empty query lists everything shortest first', () => {
  assert.deepEqual(rankPaths(FILES, '  README.MD '), [
    'README.md',
    'src/app/readme.md'
  ])
  assert.equal(rankPaths(FILES, '').length, FILES.length)
  assert.equal(rankPaths(FILES, '')[0], 'README.md')
})

test('scattered letters match as a last resort, anything else is dropped', () => {
  assert.deepEqual(rankPaths(FILES, 'wcmp'), [
    'src/web/components/AppHeader.vue'
  ])
  assert.deepEqual(rankPaths(FILES, 'zzz'), [])
})

test('a directory is scored by its name; at equal rank a file comes first (#80)', () => {
  const paths = ['src/agent/', 'src/agent.ts', 'docs/', 'README.md', 'src/']
  // An exact directory name beats a file name that only starts with it.
  assert.deepEqual(rankPaths(paths, 'agent'), ['src/agent/', 'src/agent.ts'])
  assert.deepEqual(rankPaths(paths, 'agent/'), ['src/agent/'])
  // A query that ends with `/` puts that directory before the files in it.
  assert.deepEqual(rankPaths(paths, 'src/'), [
    'src/',
    'src/agent.ts',
    'src/agent/'
  ])
  assert.deepEqual(rankPaths(['src/web/', 'src/web/a.ts', 'web/'], 'web/'), [
    'web/',
    'src/web/',
    'src/web/a.ts'
  ])
  assert.deepEqual(rankPaths(['src/b/', 'src/web/'], 'b/'), [
    'src/b/',
    'src/web/'
  ])
  assert.deepEqual(rankPaths(['a/agent/', 'b/agent'], 'agent'), [
    'b/agent',
    'a/agent/'
  ])
  assert.deepEqual(rankPaths(paths, ''), [
    'README.md',
    'src/agent.ts',
    'src/',
    'docs/',
    'src/agent/'
  ])
  assert.deepEqual(rankPaths(paths, 'doc'), ['docs/'])
})
