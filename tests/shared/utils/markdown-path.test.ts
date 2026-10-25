import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isMarkdownPath } from '../../../src/shared/utils/markdown-path.ts'

test('isMarkdownPath accepts md and markdown in any case only at the end', () => {
  for (const path of ['a.md', 'dir/B.MD', 'c.markdown', 'd.Markdown']) {
    assert.equal(isMarkdownPath(path), true, path)
  }
  for (const path of ['a.mdx', 'a.md.txt', 'md', 'a.md/', '']) {
    assert.equal(isMarkdownPath(path), false, path)
  }
})
