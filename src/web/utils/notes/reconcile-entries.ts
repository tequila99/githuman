import { equalArrays } from '@/utils/equal-arrays'
import type { NoteEntry } from '../../../shared/notes/types.ts'

export function reconcileNoteEntries(
  previous: NoteEntry[],
  next: NoteEntry[]
): NoteEntry[] {
  const byPath = new Map(previous.map(entry => [entry.path, entry]))
  const entries = next.map(entry => {
    const old = byPath.get(entry.path)
    return old &&
      old.folder === entry.folder &&
      old.id === entry.id &&
      old.presence === entry.presence &&
      old.error === entry.error &&
      equalArrays(old.tags, entry.tags)
      ? old
      : entry
  })
  return equalArrays(previous, entries) ? previous : entries
}
