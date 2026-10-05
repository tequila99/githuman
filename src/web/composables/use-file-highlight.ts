import { computed, toRaw, toValue, type MaybeRefOrGetter } from 'vue'
import type { DiffFile } from '@/api/types'
import type { TokensByLine } from '@/composables/use-syntax-highlighting'
import { useLineTokens } from '@/composables/use-line-tokens'
import { pathOf } from '@/utils/diff-file'
import { hunkText } from '@/utils/hunk-text'

/**
 * Syntax tokens of a diff file, with one entry per hunk. A closed card shows no code,
 * so `enabled` false skips the work. New hunks drop the old tokens.
 */
export function useFileHighlight(
  file: MaybeRefOrGetter<DiffFile>,
  enabled: MaybeRefOrGetter<boolean>
) {
  const { tokens, holdForTokens } = useLineTokens(() => {
    const raw = toRaw(toValue(file))
    if (!raw.hunks.some(hunk => hunk.lines.length > 0)) return null
    // The lines of this file object, not of the file that is current when the job runs.
    let text: ReturnType<typeof hunkText> | undefined
    const textOf = () => (text ??= hunkText(raw.hunks))
    return {
      key: raw,
      path: pathOf(raw),
      lines: () => textOf().lines,
      documents: () => textOf().documents
    }
  }, enabled)

  // `null` until the tokens arrive. Else one entry per hunk.
  const hunkTokens = computed<TokensByLine[] | null>(() => {
    const all = tokens.value
    if (!all) return null
    let offset = 0
    return toValue(file).hunks.map(hunk => {
      const hunkLines = all.slice(offset, offset + hunk.lines.length)
      offset += hunk.lines.length
      return hunkLines
    })
  })

  return { hunkTokens, holdForTokens }
}
