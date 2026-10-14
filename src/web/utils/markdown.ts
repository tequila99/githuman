import { headingSlug } from '../../shared/utils/heading-slug.ts'
import MarkdownIt, { type Env, type Token } from 'markdown-it'

// Output goes into v-html, so this is the trust boundary: raw HTML in the
// source is escaped (html: false), markdown-it's default link validation
// rejects unsafe URLs. Only local note attachments can render as images.
const md = new MarkdownIt({ html: false, linkify: false, breaks: false })
const renderImage = md.renderer.rules.image!
md.renderer.rules.image = (tokens, index, options, env, self) => {
  const source = String(tokens[index]?.attrGet('src') ?? '')
  if (/^\/api\/notes\/assets\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(source)) {
    return renderImage(tokens, index, options, env, self)
  }
  return md.utils.escapeHtml(tokens[index]?.content ?? '')
}
// A separate parser compares image syntax, including unsupported image sources.
const imageParser = new MarkdownIt({ html: false })

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

const defaultHeadingOpen = md.renderer.rules.heading_open
md.renderer.rules.heading_open = (tokens, index, options, env, self) => {
  if (env?.headingAnchors) {
    const text = (tokens[index + 1]?.children ?? [])
      .map(token =>
        token.type === 'text' || token.type === 'code_inline'
          ? token.content
          : token.type === 'softbreak'
            ? ' '
            : ''
      )
      .join('')
    const slug = headingSlug(text)
    const counts: Map<string, number> =
      env.headingCounts instanceof Map
        ? env.headingCounts
        : new Map<string, number>()
    env.headingCounts = counts
    const count = counts.get(slug) ?? 0
    counts.set(slug, count + 1)
    tokens[index]?.attrSet('id', count ? `${slug}-${count}` : slug)
  }
  return defaultHeadingOpen
    ? defaultHeadingOpen(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options)
}

interface RenderEnv extends Env {
  headingAnchors?: boolean
  /** Accessible name of the copy button on code blocks. */
  copyLabel?: string
}

export function renderMarkdown(source: string, env: RenderEnv = {}): string {
  return md.render(
    source,
    env.headingAnchors
      ? { ...env, headingCounts: new Map<string, number>() }
      : env
  )
}

/** Read fences from the parser so preview identities include blocks that failed to render. */
export function extractDiagramSources(source: string): string[] {
  return md
    .parse(source, {})
    .filter(
      token =>
        token.type === 'fence' &&
        token.info.trim().split(/\s+/)[0] === 'mermaid'
    )
    .map(token => token.content)
}

function markdownSignature(tokens: Token[]): unknown[] {
  return tokens.map(token => ({
    type: token.type,
    tag: token.tag,
    info: token.info,
    attrs: [...(token.attrs ?? [])].sort(([a], [b]) => a.localeCompare(b)),
    content: token.children ? undefined : token.content,
    children: token.children ? markdownSignature(token.children) : undefined
  }))
}

/** Compare parsed content so visual-editor normalization cannot hide unsupported syntax loss. */
export function sameMarkdownContent(before: string, after: string): boolean {
  return (
    JSON.stringify(markdownSignature(imageParser.parse(before, {}))) ===
    JSON.stringify(markdownSignature(imageParser.parse(after, {})))
  )
}

export function hasMarkdownImages(source: string): boolean {
  return imageParser
    .parse(source, {})
    .some(token =>
      token.children?.some(
        child =>
          child.type === 'image' &&
          !/^\/api\/notes\/assets\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(
            String(child.attrGet('src') ?? '')
          )
      )
    )
}

/** Remove editor placeholders without changing code blocks or inline HTML. */
export function normalizeNoteEmptyParagraphs(source: string): string {
  const lines = source.split('\n')
  const tokens = md.parse(source, {})
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    const inline = tokens[index + 1]
    if (
      token?.type === 'paragraph_open' &&
      token.level === 0 &&
      token.map &&
      inline?.type === 'inline' &&
      /^<br\s*\/?\s*>$/i.test(inline.content.trim())
    ) {
      for (let line = token.map[0]; line < token.map[1]; line++) {
        lines[line] = ''
      }
    }
  }
  return lines.join('\n')
}
