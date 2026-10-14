import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseMarkdownFileLink,
  resolveMarkdownFileLink
} from '@/utils/windows/markdown-file-link'

test('Markdown file links resolve absolute paths, Unicode and line suffixes inside the repository', () => {
  for (const href of [
    '/home/ivan/project/.claude/report.md',
    '/home/ivan/project/.claude/report.md:12',
    '/home/ivan/project/.claude/report.md:12:3'
  ]) {
    const link = parseMarkdownFileLink(href)!
    assert.equal(
      resolveMarkdownFileLink(link, '/home/ivan/project'),
      '.claude/report.md'
    )
  }
  const unicode = parseMarkdownFileLink(
    '/home/ivan/project/русская%20заметка.MARKDOWN#раздел%20один'
  )!
  assert.equal(
    resolveMarkdownFileLink(unicode, '/home/ivan/project/'),
    'русская заметка.MARKDOWN'
  )
  assert.equal(unicode.anchor, 'раздел один')
  const encoded = parseMarkdownFileLink(
    '%2Fhome%2Fivan%2Fproject%2Fa%23b%25.md'
  )!
  assert.equal(
    resolveMarkdownFileLink(encoded, '/home/ivan/project'),
    'a#b%.md'
  )
})

test('relative links use the repository root in chat and the source directory in file previews', () => {
  const link = parseMarkdownFileLink('./docs/report.md#heading')!
  assert.equal(resolveMarkdownFileLink(link, '/repo'), 'docs/report.md')
  assert.equal(
    resolveMarkdownFileLink(
      parseMarkdownFileLink('../other.md')!,
      '/repo',
      'docs/report.md'
    ),
    'other.md'
  )
  assert.equal(
    resolveMarkdownFileLink(
      parseMarkdownFileLink('sibling.md')!,
      '/repo',
      'docs/report.md'
    ),
    'docs/sibling.md'
  )
})

test('external URLs, protocol-relative URLs, anchors and other file types stay ordinary links', () => {
  for (const href of [
    'https://example.com/a.md',
    'mailto:a.md',
    'javascript:a.md',
    'file:///repo/a.md',
    '//example.com/a.md',
    '#heading',
    '/api/docs',
    'src/app.ts:12',
    'report.md?download=1'
  ]) {
    assert.equal(parseMarkdownFileLink(href), null)
  }
})

test('file links cannot escape the repository through traversal, encoding or a sibling prefix', () => {
  for (const href of [
    '../outside.md',
    '/repo-other/a.md',
    '/repo/../../outside.md',
    '%2e%2e/outside.md',
    '/repo/a%2f..%2f..%2foutside.md',
    '/repo/a%00.md',
    '/repo/a%5cb.md',
    '/repo/a%0a.md'
  ]) {
    assert.throws(() =>
      resolveMarkdownFileLink(parseMarkdownFileLink(href)!, '/repo')
    )
  }
  assert.throws(() => parseMarkdownFileLink('bad%zz.md'))
  assert.throws(() => parseMarkdownFileLink('ok.md#bad%zz'))
})
