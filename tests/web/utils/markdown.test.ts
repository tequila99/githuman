import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  renderMarkdown,
  sameMarkdownContent,
  hasMarkdownImages,
  normalizeNoteEmptyParagraphs
} from '@/utils/markdown'

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

test('link titles use delegated tooltip data with escaped text', () => {
  const html = renderMarkdown("[x](https://example.com 'A & <B>')")
  assert.match(html, /data-tooltip="A &amp; &lt;B&gt;"/)
  assert.doesNotMatch(html, /\stitle=/)
})

test('code copy controls use delegated tooltips and escape labels', () => {
  const html = renderMarkdown('```ts\nconst x = 1\n```', {
    copyLabel: 'Copy "code" <x>'
  })
  assert.match(html, /data-tooltip="Copy &quot;code&quot; &lt;x&gt;"/)
  assert.doesNotMatch(html, /\stitle=/)
})

test('note heading anchors use visible text, disambiguate duplicates and reset on each render', () => {
  const source =
    '# **Hello** [world](https://example.com)\n\n# Hello world\n\n## Привет `мир`\n'
  const options = { headingAnchors: true }
  const first = renderMarkdown(source, options)
  assert.match(first, /id="hello-world"/)
  assert.match(first, /id="hello-world-1"/)
  assert.match(first, /id="привет-мир"/)
  assert.equal(renderMarkdown(source, options), first)
  assert.doesNotMatch(renderMarkdown(source), /id="hello-world"/)
})

test('visual normalization keeps Markdown meaning but unsupported content loss is detected', () => {
  assert.equal(sameMarkdownContent('- one\n- two\n', '* one\n* two\n'), true)
  assert.equal(
    sameMarkdownContent(
      '[Plan][plan]\n\n[plan]: ./plan.md "Title"\n',
      '[Plan](./plan.md "Title")\n'
    ),
    true
  )
  assert.equal(sameMarkdownContent('![diagram](./diagram.png)\n', ''), false)
  assert.equal(
    sameMarkdownContent(
      '```ts\nconst x = 1\n```\n',
      '```ts\nconst x = 2\n```\n'
    ),
    false
  )
  assert.equal(sameMarkdownContent('[link](../a.md)', '[link](../b.md)'), false)
})

test('images use source mode while image-like code and escaped text stay editable', () => {
  assert.equal(hasMarkdownImages('![diagram](https://example.com/a.png)'), true)
  assert.equal(hasMarkdownImages('![diagram][pic]\n\n[pic]: ./a.png'), true)
  assert.equal(hasMarkdownImages('```md\n![diagram](./a.png)\n```'), false)
  assert.equal(hasMarkdownImages('`![diagram](./a.png)`'), false)
  assert.equal(hasMarkdownImages('\\![diagram](./a.png)'), false)
})

test('note empty-paragraph placeholders become blank lines while code and inline HTML stay intact', () => {
  const source =
    '# Title\n\n<br />\n\nText<br />next\n\n```html\n<br />\n```\n\n`<br />`\n'
  assert.equal(
    normalizeNoteEmptyParagraphs(source),
    '# Title\n\n\n\nText<br />next\n\n```html\n<br />\n```\n\n`<br />`\n'
  )
})

test('permanent local note attachments render and stay editable after reload', () => {
  const url = '/api/notes/assets/' + 'a'.repeat(64) + '.png'
  const source = `![image](${url})`
  assert.match(renderMarkdown(source), /<img src="\/api\/notes\/assets\//)
  assert.equal(hasMarkdownImages(source), false)
  assert.equal(sameMarkdownContent(source, 'image'), false)
  assert.doesNotMatch(
    renderMarkdown('![x](https://example.com/pixel.png)'),
    /<img/
  )
})
