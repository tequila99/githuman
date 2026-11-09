import type { Ref } from 'vue'
import type { ArtifactSearchItem } from '@/api/types'

/** One suggestion for a link in a Markdown editor. */
export interface EditorLinkTarget {
  key: string
  label: string
  caption: string
  href: string
  artifact?: ArtifactSearchItem
}

/** Supplies suggestions for the text typed after the mention character. */
export interface EditorLinkSource {
  matches: Readonly<Ref<readonly EditorLinkTarget[]>>
  /** `null` means no search is open. */
  setQuery: (query: string | null) => void
}

/** Moves the highlighted suggestion by `step` and wraps around the ends. */
export function moveActive(active: number, step: number, length: number) {
  return length ? (active + step + length) % length : 0
}

export function markdownLink(target: EditorLinkTarget, label = target.label) {
  return `[${label.replace(/[\\[\]]/g, char => '\\' + char)}](${target.href})`
}
