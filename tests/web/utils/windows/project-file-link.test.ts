import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseProjectFileLink,
  projectFileFromQuery,
  projectFileRoute
} from '@/utils/windows/project-file-link'
import { renderMarkdown } from '@/utils/markdown'

const context = {
  repositoryPath: '/repo',
  origin: 'http://192.168.1.2:3850',
  origins: ['http://localhost:3850']
}

test('agent-independent file links normalize paths, origins and positions', () => {
  for (const href of [
    'docs/a.pdf',
    '/repo/docs/a.pdf',
    'file:///repo/docs/a.pdf',
    'http://localhost:3850/repo/docs/a.pdf',
    context.origin + '/repo/docs/a.pdf'
  ]) {
    assert.deepEqual(parseProjectFileLink(href, context), {
      path: 'docs/a.pdf',
      anchor: ''
    })
  }
  assert.equal(
    parseProjectFileLink('../sibling.txt', { ...context, from: 'docs/note.md' })
      ?.path,
    'sibling.txt'
  )
  assert.deepEqual(parseProjectFileLink('a.ts:12:3', context), {
    path: 'a.ts',
    anchor: '',
    line: 12,
    column: 3
  })
  assert.equal(parseProjectFileLink('Makefile:12', context)?.line, 12)
  assert.equal(parseProjectFileLink('a%3A12', context)?.path, 'a:12')
  assert.equal(
    parseProjectFileLink('текст%20%23%25.md#раздел', context)?.path,
    'текст #%.md'
  )
  assert.match(
    projectFileRoute({ path: 'a b.pdf', anchor: '' }),
    /^\/files\/open\?path=a\+b.pdf&ref=WORKTREE$/
  )
})

test('web links, app routes, protocols and query links are not treated as files', () => {
  for (const href of [
    'https://example.com/repo/a.pdf',
    'http://localhost:9000/repo/a.pdf',
    '//host/a.pdf',
    '/notes',
    '/notes?uiPane=list',
    '/api/git/info?x=1',
    '/api/git/info',
    '#heading',
    'mailto:a',
    'tel:5551234',
    'TEL:5551234',
    'sms:123',
    'javascript:alert(1)',
    'file://other/repo/a.pdf',
    'https://example.com/a.pdf?download=1'
  ]) {
    assert.equal(parseProjectFileLink(href, context), null, href)
  }
  for (const href of [
    '../outside',
    'bad%00.md',
    'bad%5cname',
    'bad%zz',
    'a.pdf?download=1'
  ]) {
    assert.throws(() => parseProjectFileLink(href, context))
  }
})

test('file URI becomes a safe clickable route only in file-link rendering context', () => {
  const source =
    '[PDF](file:///repo/a.pdf) [web](https://example.com) [unsafe](javascript:alert(1))'
  const html = renderMarkdown(source, {
    fileLink: href => {
      const link = parseProjectFileLink(href, context)
      return link ? projectFileRoute(link) : href
    }
  })
  assert.match(html, /href="\/files\/open\?path=a.pdf&amp;ref=WORKTREE"/)
  assert.match(html, /href="https:\/\/example.com"/)
  assert.doesNotMatch(html, /href="(?:file:|javascript:)/)
  assert.doesNotMatch(renderMarkdown(source), /href="file:/)
})

// Rewrites every file: link to an internal route.
const rewrite = (href: string) =>
  href.startsWith('file:') ? '/files/open?path=x' : href

test('file-link rewriting does not leak between renders or into other parsing', () => {
  assert.match(
    renderMarkdown('[a](file:///repo/a.pdf)', { fileLink: rewrite }),
    /href="\/files\/open/
  )
  assert.doesNotMatch(renderMarkdown('[a](file:///repo/a.pdf)'), /<a /)
  assert.throws(() =>
    renderMarkdown('[a](file:///repo/a.pdf)', {
      fileLink: () => {
        throw new Error('boom')
      }
    })
  )
  assert.doesNotMatch(renderMarkdown('[a](file:///repo/a.pdf)'), /<a /)
})

test('route parameters read back into the same link and ref', () => {
  const link = { path: 'a b.ts', anchor: 'part', line: 12, column: 3 }
  const query = new URLSearchParams(projectFileRoute(link, 'abc').split('?')[1])
  assert.deepEqual(
    projectFileFromQuery(key => query.get(key)),
    {
      link,
      ref: 'abc'
    }
  )
  const bare = new URLSearchParams({ path: 'x.md' })
  assert.deepEqual(
    projectFileFromQuery(key => bare.get(key)),
    {
      link: { path: 'x.md', anchor: '', line: undefined, column: undefined },
      ref: 'WORKTREE'
    }
  )
  assert.equal(
    projectFileFromQuery(() => null),
    null
  )
})
