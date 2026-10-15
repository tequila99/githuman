import { fromMarkdown } from 'mdast-util-from-markdown'
import { splitNote } from './document.ts'
import { destinationRange } from './references.ts'
import { NOTE_IMAGE_EXTENSIONS } from './asset-formats.ts'
import {
  isCredentialFreeWebUrl,
  webUrlFileName,
  webUrlLastSegment
} from '../utils/web-url.ts'

export interface ExternalNoteAsset {
  url: string
  kind: 'image' | 'pdf'
  name: string
  occurrences: number
}

export interface ExternalAssetEdit {
  start: number
  end: number
  value: string
}

/** Edits that undo `edits` when applied to the text they produced. */
export function invertExternalAssetEdits(
  text: string,
  edits: readonly ExternalAssetEdit[]
): ExternalAssetEdit[] {
  let delta = 0
  return [...edits]
    .sort((a, b) => a.start - b.start)
    .map(edit => {
      const start = edit.start + delta
      delta += edit.value.length - (edit.end - edit.start)
      return {
        start,
        end: start + edit.value.length,
        value: text.slice(edit.start, edit.end)
      }
    })
}

export function externalAssetOffset(
  offset: number,
  edits: readonly ExternalAssetEdit[]
) {
  let delta = 0
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    if (offset < edit.start) break
    if (offset < edit.end) {
      return (
        edit.start + delta + Math.min(offset - edit.start, edit.value.length)
      )
    }
    delta += edit.value.length - (edit.end - edit.start)
  }
  return offset + delta
}

interface AssetDestination {
  url: string
  fragment: string
  kind: 'image' | 'pdf'
  start: number
  end: number
  occurrences: number
}

function assetDestinations(text: string, protocol: string): AssetDestination[] {
  const { body } = splitNote(text)
  const offset = text.length - body.length
  const tree = fromMarkdown(body)
  const uses = new Map<string, boolean[]>()
  const walk = (node: typeof tree | (typeof tree.children)[number]) => {
    if (node.type === 'imageReference' || node.type === 'linkReference') {
      const group = uses.get(node.identifier) ?? []
      group.push(node.type === 'imageReference')
      uses.set(node.identifier, group)
    }
    if ('children' in node) for (const child of node.children) walk(child)
  }
  walk(tree)
  const result: AssetDestination[] = []
  const visit = (node: typeof tree | (typeof tree.children)[number]) => {
    if (
      node.type === 'image' ||
      node.type === 'link' ||
      node.type === 'definition'
    ) {
      const references =
        node.type === 'definition' ? uses.get(node.identifier) : undefined
      const image = node.type === 'image' || references?.some(Boolean)
      const count = node.type === 'definition' ? (references?.length ?? 0) : 1
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (count && start !== undefined && end !== undefined) {
        try {
          const url = new URL(
            node.url.startsWith('//') ? protocol + node.url : node.url
          )
          if (!isCredentialFreeWebUrl(url)) return
          const extension = webUrlLastSegment(url)
            .split('.')
            .at(-1)
            ?.toLowerCase()
          const kind = image
            ? 'image'
            : extension === 'pdf'
              ? 'pdf'
              : NOTE_IMAGE_EXTENSIONS.includes(extension ?? '')
                ? 'image'
                : null
          const range = destinationRange(
            body.slice(start, end),
            node.type === 'definition'
          )
          if (kind && range) {
            const fragment = url.hash
            url.hash = ''
            result.push({
              url: url.href,
              fragment,
              kind,
              start: offset + start + range[0],
              end: offset + start + range[1],
              occurrences: count
            })
          }
        } catch {
          // Invalid destinations are not download candidates.
        }
      }
    }
    if ('children' in node) for (const child of node.children) visit(child)
  }
  visit(tree)
  return result
}

export function externalNoteAssets(
  text: string,
  protocol = 'https:'
): ExternalNoteAsset[] {
  const assets = new Map<string, ExternalNoteAsset>()
  for (const item of assetDestinations(text, protocol)) {
    const existing = assets.get(item.url)
    if (existing) {
      existing.occurrences += item.occurrences
      if (item.kind === 'image') existing.kind = 'image'
    } else {
      assets.set(item.url, {
        url: item.url,
        kind: item.kind,
        name: webUrlFileName(new URL(item.url)),
        occurrences: item.occurrences
      })
    }
  }
  return [...assets.values()]
}

export function replaceExternalNoteAssets(
  text: string,
  replacements: ReadonlyMap<string, string>,
  protocol = 'https:'
) {
  let result = text
  let count = 0
  const edits = assetDestinations(text, protocol)
    .filter(item => replacements.has(item.url))
    .sort((a, b) => b.start - a.start)
  for (const item of edits) {
    result =
      result.slice(0, item.start) +
      replacements.get(item.url)! +
      item.fragment +
      result.slice(item.end)
    count += item.occurrences
  }
  return {
    text: result,
    count,
    edits: edits.map(item => ({
      start: item.start,
      end: item.end,
      value: replacements.get(item.url)! + item.fragment
    }))
  }
}

export function isNoteAssetShortcut(
  event: Pick<
    KeyboardEvent,
    | 'code'
    | 'ctrlKey'
    | 'shiftKey'
    | 'altKey'
    | 'metaKey'
    | 'repeat'
    | 'isComposing'
  >
) {
  return (
    event.code === 'KeyD' &&
    event.ctrlKey &&
    event.metaKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.repeat &&
    !event.isComposing
  )
}
