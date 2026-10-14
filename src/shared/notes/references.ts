import { localReference, wikiReference } from './reference-path.ts'
export { localReference, wikiReference } from './reference-path.ts'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { isMap, isSeq, isScalar, parseDocument } from 'yaml'
import { splitNote } from './document.ts'
import { noteLink } from './links.ts'

export interface NoteReference {
  href: string
  start: number
  end: number
  context: string
  format: 'markdown' | 'yaml' | 'wiki'
  image: boolean
  displayStarts?: number[]
}

// The AST excludes code and HTML; this scanner locates only a parsed destination.
function destinationRange(
  source: string,
  definition: boolean
): [number, number] | null {
  let depth = 0
  let cursor = source.startsWith('!') ? 1 : 0
  for (; cursor < source.length; cursor++) {
    if (source[cursor] === '\\') {
      cursor++
      continue
    }
    if (source[cursor] === '[') depth++
    if (source[cursor] === ']' && --depth === 0) {
      cursor++
      break
    }
  }
  while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor++
  if (source[cursor] !== (definition ? ':' : '(')) return null
  cursor++
  while (cursor < source.length && /\s/.test(source[cursor]!)) cursor++
  const angle = source[cursor] === '<'
  if (angle) cursor++
  const start = cursor
  depth = 0
  for (; cursor < source.length; cursor++) {
    const char = source[cursor]!
    if (char === '\\') {
      cursor++
      continue
    }
    if (angle && char === '>') break
    if (!angle) {
      if (char === '(') depth++
      if (char === ')') {
        if (!depth) break
        depth--
      }
      if (/\s/.test(char)) break
    }
  }
  return cursor >= start ? [start, cursor] : null
}

export function noteReferences(text: string): NoteReference[] {
  let parts
  try {
    parts = splitNote(text)
  } catch {
    return []
  }
  const result: NoteReference[] = []
  const bodyOffset = text.length - parts.body.length
  const tree = fromMarkdown(parts.body)
  const uses = new Map<string, { position: number; image: boolean }[]>()
  const definitions = new Map<NoteReference, string>()
  const visit = (node: typeof tree | (typeof tree.children)[number]) => {
    if (node.type === 'linkReference' || node.type === 'imageReference') {
      const group = uses.get(node.identifier) ?? []
      group.push({
        position: bodyOffset + (node.position?.start.offset ?? 0),
        image: node.type === 'imageReference'
      })
      uses.set(node.identifier, group)
    }
    if (
      node.type === 'link' ||
      node.type === 'image' ||
      node.type === 'definition'
    ) {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) {
        const raw = parts.body.slice(start, end)
        const range = destinationRange(raw, node.type === 'definition')
        if (range) {
          result.push({
            href: node.url,
            start: bodyOffset + start + range[0],
            end: bodyOffset + start + range[1],
            context: raw.slice(0, range[0]) + '<href>' + raw.slice(range[1]),
            format: 'markdown',
            image: node.type === 'image',
            displayStarts: [bodyOffset + start]
          })
        }
        if (range && node.type === 'definition') {
          definitions.set(result[result.length - 1]!, node.identifier)
        }
      }
    }
    if ('children' in node) for (const child of node.children) visit(child)
  }
  visit(tree)
  for (const [ref, identifier] of definitions) {
    const references = uses.get(identifier) ?? []
    ref.displayStarts = references.map(use => use.position)
    ref.image = references.length > 0 && references.every(use => use.image)
  }
  try {
    const doc = parseDocument(parts.yaml)
    const offset = text.indexOf(parts.yaml, text.startsWith('\uFEFF') ? 5 : 4)
    if (doc.errors.length || !isMap(doc.contents)) return result
    const scalar = (value: unknown, key: string) => {
      if (!isScalar(value) || typeof value.value !== 'string' || !value.range) {
        return
      }
      const wiki = value.value.startsWith('[[')
      if (!wiki && !/\.md(?:#|$)/i.test(value.value)) return
      result.push({
        href: value.value,
        start: offset + value.range[0],
        end: offset + value.range[1],
        context: 'yaml:' + key,
        format: wiki ? 'wiki' : 'yaml',
        image: false,
        displayStarts: [offset + value.range[0]]
      })
    }
    for (const pair of doc.contents.items) {
      if (
        !isScalar(pair.key) ||
        pair.key.value === 'githuman_id' ||
        pair.key.value === 'tags'
      ) {
        continue
      }
      const key = String(pair.key.value)
      if (isSeq(pair.value)) {
        for (const value of pair.value.items) scalar(value, key)
      } else {
        scalar(pair.value, key)
      }
    }
  } catch {
    /* Invalid YAML must not prevent indexing the Markdown body. */
  }
  return result
}

export function referenceTarget(
  ref: NoteReference,
  from: string,
  paths: readonly string[]
) {
  if (ref.format === 'wiki') {
    const wiki = wikiReference(ref.href, from, paths)
    return wiki?.path
      ? { path: wiki.path, anchor: encodeURIComponent(wiki.anchor) }
      : null
  }
  return localReference(from, ref.href)
}

export function rewriteReferences(
  text: string,
  changes: {
    reference: NoteReference
    from: string
    target: string
    anchor: string
  }[]
): string {
  let result = text
  for (const change of [...changes].sort(
    (a, b) => b.reference.start - a.reference.start
  )) {
    const ref = change.reference
    const href =
      noteLink(change.from, change.target) +
      (change.anchor ? '#' + change.anchor : '')
    let replacement = href
    if (ref.format === 'wiki') {
      const alias = ref.href.match(/\|([^\]]+)\]\]$/)?.[1]
      replacement =
        '[[' +
        change.target.replace(/\.md$/i, '') +
        (change.anchor ? '#' + decodeURIComponent(change.anchor) : '') +
        (alias ? '|' + alias : '') +
        ']]'
    }
    if (ref.format !== 'markdown') replacement = JSON.stringify(replacement)
    result = result.slice(0, ref.start) + replacement + result.slice(ref.end)
  }
  return result
}

export function sameReference(a: NoteReference, b: NoteReference): boolean {
  return a.href === b.href && a.context === b.context && a.format === b.format
}
