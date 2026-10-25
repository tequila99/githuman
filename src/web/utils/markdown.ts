import { headingSlug } from '../../shared/utils/heading-slug.ts'
import MarkdownIt, { type Env, type Token } from 'markdown-it'
import { NOTE_ASSET_ID_PATTERN } from '../../shared/notes/asset-formats.ts'
import {
  FILE_URI_PATTERN,
  PROJECT_FILE_INVALID_QUERY,
  PROJECT_FILE_ROUTE
} from '../../shared/project-files/constants.ts'

// A rewritten file link: the open route, with an optional base path and "#" prefix.
const OPEN_ROUTE_LINK = new RegExp(
  '^(?:/[^?#]*)?#?' + PROJECT_FILE_ROUTE.replaceAll('/', '\\/') + '\\?'
)
// A rewritten link to an error: the original target is not a project file.
const INVALID_LINK = new RegExp('[?&]' + PROJECT_FILE_INVALID_QUERY + '(?:&|$)')

// A table sits in this box. The box scrolls a wide table, so the table can fill the column.
const TABLE_WRAPPER_CLASS = 'md-table'

// Same-origin note attachment URL. The server and the renderer share one
// identifier pattern, so a new asset format cannot be accepted by only one side.
const NOTE_ASSET_URL = new RegExp(
  '^/api/notes/assets/' + NOTE_ASSET_ID_PATTERN.slice(1)
)

// Output goes into v-html, so this is the trust boundary: raw HTML in the
// source is escaped (html: false), markdown-it's default link validation
// rejects unsafe URLs. Only local note attachments can render as images.
// This parser also renders agent messages, so image rendering there is limited
// to the same attachments: no external image URL can load from message text.
const md = new MarkdownIt({ html: false, linkify: false, breaks: false })
// The renderer is synchronous, so one module variable can carry the rewrite
// function of the current render. Other parser calls see no rewrite function.
let currentFileLink: ((href: string) => string) | undefined
// A file: link is valid only when this render rewrites it to an internal route.
const validateLink = md.validateLink.bind(md)
md.validateLink = href =>
  validateLink(href) ||
  (currentFileLink !== undefined &&
    FILE_URI_PATTERN.test(href) &&
    OPEN_ROUTE_LINK.test(currentFileLink(href)))
const renderImage = md.renderer.rules.image!
md.renderer.rules.image = (tokens, index, options, env, self) => {
  const source = String(tokens[index]?.attrGet('src') ?? '')
  if (NOTE_ASSET_URL.test(source)) {
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
  const href = token?.attrGet('href')
  if (href && typeof env?.fileLink === 'function') {
    const rewritten = env.fileLink(href)
    token?.attrSet('href', rewritten)
    // The error page hides where the link led, so the tooltip shows it.
    if (INVALID_LINK.test(rewritten) && !title) {
      token?.attrSet('data-tooltip', href)
    }
  }
  token?.attrSet('target', '_blank')
  token?.attrSet('rel', 'noopener noreferrer')
  return renderLinkOpen(tokens, idx, options, env, self)
}

// markdown-it has no own table rules, so the wrapper adds markup around the default output.
const renderTableOpen =
  md.renderer.rules.table_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
const renderTableClose =
  md.renderer.rules.table_close ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.table_open = (tokens, idx, options, env, self) =>
  `<div class="${TABLE_WRAPPER_CLASS}">\n` +
  renderTableOpen(tokens, idx, options, env, self)
md.renderer.rules.table_close = (tokens, idx, options, env, self) =>
  renderTableClose(tokens, idx, options, env, self) + '</div>\n'

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
  fileLink?: ((href: string) => string) | undefined
}

function memoize(rewrite: (href: string) => string): (href: string) => string {
  const cache = new Map<string, string>()
  return href => {
    let result = cache.get(href)
    if (result === undefined) {
      result = rewrite(href)
      cache.set(href, result)
    }
    return result
  }
}

export function renderMarkdown(source: string, env: RenderEnv = {}): string {
  // The parser and the renderer both rewrite each file link: cache per render.
  const fileLink = env.fileLink && memoize(env.fileLink)
  currentFileLink = fileLink
  const renderEnv = { ...env, fileLink }
  try {
    return md.render(
      source,
      env.headingAnchors
        ? { ...renderEnv, headingCounts: new Map<string, number>() }
        : renderEnv
    )
  } finally {
    currentFileLink = undefined
  }
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

interface SignatureItem {
  type: string
  tag: string
  info: string
  attrs: [string, string | number][]
  content?: string | undefined
  children?: SignatureItem[] | undefined
  marks?: string[] | undefined
}

/**
 * The editor writes a bare URL, and a link whose text equals its target, as
 * `<url>`. Such a link has no other target or text, so it counts as plain text
 * of that URL; no content is lost.
 */
function isSelfLink(open: Token, text: Token | undefined): boolean {
  return (
    open.type === 'link_open' &&
    text?.type === 'text' &&
    (open.markup === 'autolink' ||
      (!open.attrGet('title') && text.content === open.attrGet('href')))
  )
}

function markdownSignature(tokens: Token[]): SignatureItem[] {
  const items: SignatureItem[] = []
  const marks: string[] = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    const text = tokens[index + 1]
    const selfLink =
      isSelfLink(token, text) && tokens[index + 2]?.type === 'link_close'
    // Compare formatting on content, independent of link and emphasis nesting order.
    if (/^(em|strong|s|link)_open$/.test(token.type) && !selfLink) {
      marks.push(
        JSON.stringify({
          type: token.type,
          attrs: [...(token.attrs ?? [])].sort(([a], [b]) => a.localeCompare(b))
        })
      )
      continue
    }
    if (/^(em|strong|s|link)_close$/.test(token.type)) {
      marks.pop()
      continue
    }
    if (token.type === 'text' && !token.content) continue
    const activeMarks = marks.length ? [...marks].sort() : undefined
    if (selfLink) {
      items.push({
        type: 'text',
        tag: '',
        info: '',
        attrs: [],
        content: text!.content,
        marks: activeMarks
      })
      index += 2
      continue
    }
    items.push({
      marks: activeMarks,
      type: token.type,
      tag: token.tag,
      info: token.info,
      attrs: [...(token.attrs ?? [])].sort(([a], [b]) => a.localeCompare(b)),
      content: token.children ? undefined : token.content,
      children: token.children ? markdownSignature(token.children) : undefined
    })
  }
  return items.reduce<SignatureItem[]>((merged, item) => {
    const last = merged.at(-1)
    if (
      last?.type === 'text' &&
      item.type === 'text' &&
      JSON.stringify(last.marks) === JSON.stringify(item.marks)
    ) {
      last.content = (last.content ?? '') + (item.content ?? '')
    } else {
      merged.push(item)
    }
    return merged
  }, [])
}

/** Compare parsed content so visual-editor normalization cannot hide unsupported syntax loss. */
export function sameMarkdownContent(before: string, after: string): boolean {
  return (
    JSON.stringify(markdownSignature(imageParser.parse(before, {}))) ===
    JSON.stringify(markdownSignature(imageParser.parse(after, {})))
  )
}

export function hasUnsupportedMarkdownImages(source: string): boolean {
  return imageParser
    .parse(source, {})
    .some(token =>
      token.children?.some(
        child =>
          child.type === 'image' &&
          !NOTE_ASSET_URL.test(String(child.attrGet('src') ?? '')) &&
          !/^https?:\/\//i.test(String(child.attrGet('src') ?? ''))
      )
    )
}

/**
 * True when plain text starts like an ordered-list item. The editor must
 * escape it, or the next parse turns the paragraph into a list.
 */
export function startsLikeListMarker(value: string): boolean {
  return /^\s*\d+[.)]\s/.test(value)
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
