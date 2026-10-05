import type { DiffHunk } from '@/api/types'
import type { LineDocument } from '@/utils/shiki-engine'

/** The text the highlighter reads for a list of hunks. */
export interface HunkText {
  /** The lines of all hunks in order, each hunk after its preamble. */
  lines: string[]
  /**
   * One part per hunk, so each hunk starts with its own grammar state. `undefined` when no
   * hunk has a preamble: the hunks then read as one text, as before the preamble existed.
   */
  documents: LineDocument[] | undefined
}

/** Lines and documents for the highlighter. The tokens of a preamble are not returned. */
export function hunkText(hunks: readonly DiffHunk[]): HunkText {
  if (!hunks.some(hunk => hunk.preamble && hunk.preamble.length > 0)) {
    return {
      lines: hunks.flatMap(hunk => hunk.lines.map(line => line.content)),
      documents: undefined
    }
  }
  const lines: string[] = []
  const documents: LineDocument[] = []
  for (const hunk of hunks) {
    const preamble = hunk.preamble ?? []
    lines.push(...preamble, ...hunk.lines.map(line => line.content))
    documents.push({
      length: preamble.length + hunk.lines.length,
      skip: preamble.length
    })
  }
  return { lines, documents }
}
