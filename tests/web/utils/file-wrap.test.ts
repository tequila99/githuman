import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isMarkdown } from '@/utils/file-wrap'

test('isMarkdown detects .md case-insensitively', () => {
  assert.equal(isMarkdown('README.md'), true)
  assert.equal(isMarkdown('README.MD'), true)
  assert.equal(isMarkdown('docs/notes.Md'), true)
})

test('isMarkdown is false for other extensions and extension-less paths', () => {
  assert.equal(isMarkdown('a.ts'), false)
  assert.equal(isMarkdown('a'), false)
  assert.equal(isMarkdown('a/b/c.markdown'), false)
})
