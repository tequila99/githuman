import { noteMetadata } from '../../../shared/notes/document.ts'
import {
  noteIdentity,
  withNoteIdentity
} from '../../../shared/notes/identity.ts'

export function hasNoteFrontmatter(text: string): boolean {
  return /^\uFEFF?---\r?\n/.test(text)
}

export function importNoteDocument(
  current: string,
  source: string,
  id?: string
): string {
  if (!hasNoteFrontmatter(source)) {
    throw new Error('Expected Markdown with YAML frontmatter')
  }
  const metadata = noteMetadata(source)
  if (metadata.error) throw new Error(metadata.error)
  const identity = id ?? noteIdentity(current).id
  return identity ? withNoteIdentity(source, identity) : source
}
