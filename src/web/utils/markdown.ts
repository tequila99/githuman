import MarkdownIt, { type Env } from 'markdown-it'

// Output goes into v-html, so this is the trust boundary: raw HTML in the
// source is escaped (html: false), markdown-it's default link validation
// rejects javascript:/vbscript:/data: URLs, and images are off entirely — an
// agent-controlled <img src> would be a free tracking pixel.
const md = new MarkdownIt({ html: false, linkify: false, breaks: false })
md.disable('image')

const renderLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const title = token?.attrGet('title')
  if (title && token?.attrs) {
    token.attrs = token.attrs.filter(([name]) => name !== 'title')
    token.attrSet('data-tooltip', title)
  }
  token?.attrSet('target', '_blank')
  token?.attrSet('rel', 'noopener noreferrer')
  return renderLinkOpen(tokens, idx, options, env, self)
}

// Code blocks get a copy button. It is static markup (the code itself is
// escaped by the default renderer) and the page wires the click. Mermaid
// sources are left alone: they are replaced by the diagram they draw.
const defaultFence = md.renderer.rules.fence

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const rendered = defaultFence
    ? defaultFence(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options)
  const language = tokens[idx]?.info.trim().split(/\s+/)[0]
  if (language === 'mermaid') return rendered
  const copyLabel = env?.copyLabel
  const label = md.utils.escapeHtml(
    typeof copyLabel === 'string' ? copyLabel : 'Copy'
  )
  return (
    '<div class="agent-code">' +
    `<button type="button" class="agent-code__copy" data-copy data-tooltip="${label}" aria-label="${label}">` +
    '<svg class="agent-code__copy-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>' +
    '<svg class="agent-code__done-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>' +
    '</button>' +
    rendered +
    '</div>'
  )
}

interface RenderEnv extends Env {
  /** Accessible name of the copy button on code blocks. */
  copyLabel?: string
}

export function renderMarkdown(source: string, env: RenderEnv = {}): string {
  return md.render(source, env)
}
