import type { NoteEntry } from '../../shared/notes/types.ts'

export interface NoteNavigationItem {
  path: string
  label: string
  folder: boolean
}

export function compareNoteItems(
  a: Pick<NoteNavigationItem, 'folder' | 'label'>,
  b: Pick<NoteNavigationItem, 'folder' | 'label'>
): number {
  return Number(b.folder) - Number(a.folder) || a.label.localeCompare(b.label)
}

export function noteFolderChildren(
  entries: NoteEntry[],
  folder: string
): NoteNavigationItem[] {
  const prefix = folder ? folder + '/' : ''
  const children = new Map<string, NoteNavigationItem>()
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue
    const relative = entry.path.slice(prefix.length)
    if (!relative) continue
    const name = relative.split('/')[0]!
    const path = prefix + name
    const isFolder = relative.includes('/') || entry.folder
    children.set(path, {
      path,
      label: isFolder ? name : name.replace(/\.md$/i, ''),
      folder: isFolder
    })
  }
  return [...children.values()].sort(compareNoteItems)
}

export type NoteTagMode = 'all' | 'any'

export function matchesNoteTags(
  tags: readonly string[],
  selected: readonly string[],
  mode: NoteTagMode
): boolean {
  return (
    !selected.length ||
    (mode === 'all'
      ? selected.every(tag => tags.includes(tag))
      : selected.some(tag => tags.includes(tag)))
  )
}
