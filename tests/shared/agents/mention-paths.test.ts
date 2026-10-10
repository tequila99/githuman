import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isDirectoryPath,
  mentionParts,
  withDirectories,
  withoutTrailingSlash
} from '../../../src/shared/agents/mention-paths.ts'

test('a trailing slash marks a directory, and the context form drops it', () => {
  assert.equal(isDirectoryPath('src/web/'), true)
  assert.equal(isDirectoryPath('src/web'), false)
  assert.equal(withoutTrailingSlash('src/web/'), 'src/web')
  assert.equal(withoutTrailingSlash('src/web//'), 'src/web')
  assert.equal(withoutTrailingSlash('a.ts'), 'a.ts')
})

test('withDirectories adds every parent directory once and keeps the files', () => {
  assert.deepEqual(withDirectories(['a/b/c.ts', 'a/d.ts', 'e.ts']), [
    'a/b/c.ts',
    'a/d.ts',
    'e.ts',
    'a/',
    'a/b/'
  ])
})

test('an untracked nested repository listed as dir/ is a directory, not a file', () => {
  assert.deepEqual(withDirectories(['vendor/lib/', 'x.ts']), [
    'x.ts',
    'vendor/',
    'vendor/lib/'
  ])
})

test('mentionParts splits a path into name and parent, with / on a directory name', () => {
  assert.deepEqual(mentionParts('src/web/'), {
    name: 'web/',
    parent: 'src',
    directory: true
  })
  assert.deepEqual(mentionParts('src/a.ts'), {
    name: 'a.ts',
    parent: 'src',
    directory: false
  })
  assert.deepEqual(mentionParts('docs/'), {
    name: 'docs/',
    parent: '',
    directory: true
  })
})
