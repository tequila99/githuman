import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from '@/utils/markdown'

test('renders basic markdown', () => {
  const html = renderMarkdown('**bold** and `code`\n\n- a\n- b')
  assert.match(html, /<strong>bold<\/strong>/)
  assert.match(html, /<code>code<\/code>/)
  assert.match(html, /<li>a<\/li>/)
})

test('raw HTML from the agent is escaped, not rendered', () => {
  const html = renderMarkdown(
    '<script>alert(1)</script><img src=x onerror=alert(1)>'
  )
  assert.doesNotMatch(html, /<script/i)
  assert.doesNotMatch(html, /<img/i)
  assert.match(html, /&lt;script&gt;/)
})

test('javascript: and data: links are not turned into links', () => {
  for (const url of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html;base64,AAAA',
    'vbscript:x'
  ]) {
    assert.doesNotMatch(renderMarkdown(`[x](${url})`), /<a /i, url)
  }
})

test('http links open in a new tab without opener access', () => {
  const html = renderMarkdown('[x](https://example.com)')
  assert.match(html, /href="https:\/\/example\.com"/)
  assert.match(html, /target="_blank"/)
  assert.match(html, /rel="noopener noreferrer"/)
})

test('images are not rendered (no remote loads chosen by the agent)', () => {
  assert.doesNotMatch(
    renderMarkdown('![x](https://evil.example/p.png)'),
    /<img/i
  )
})
