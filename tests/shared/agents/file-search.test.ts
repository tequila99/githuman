import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankFiles } from '../../../src/shared/agents/file-search.ts'

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
  assert.deepEqual(rankFiles(FILES, 'app'), [
    'src/web/App.vue',
    'src/server/app.ts',
    'tests/server/app.test.ts',
    'docs/application-notes.md',
    'src/web/components/AppHeader.vue',
    'src/app/readme.md'
  ])
  assert.deepEqual(rankFiles(FILES, 'readme.md'), [
    'README.md',
    'src/app/readme.md'
  ])
})

test('matching ignores case and surrounding blanks; an empty query lists everything shortest first', () => {
  assert.deepEqual(rankFiles(FILES, '  README.MD '), [
    'README.md',
    'src/app/readme.md'
  ])
  assert.equal(rankFiles(FILES, '').length, FILES.length)
  assert.equal(rankFiles(FILES, '')[0], 'README.md')
})

test('scattered letters match as a last resort, anything else is dropped', () => {
  assert.deepEqual(rankFiles(FILES, 'wcmp'), [
    'src/web/components/AppHeader.vue'
  ])
  assert.deepEqual(rankFiles(FILES, 'zzz'), [])
})
