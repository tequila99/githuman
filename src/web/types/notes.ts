import type { NoteTagMode } from '@/utils/note-navigation'

export interface NoteTagFilter {
  tags: string[]
  mode: NoteTagMode
}
