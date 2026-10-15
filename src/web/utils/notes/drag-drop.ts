import { noteBasename, noteChildPath } from '../../../shared/notes/note-path.ts'
import type { NoteEntry } from '../../../shared/notes/types.ts'

// A private type prevents file uploads and text drags from moving notes.
export const NOTE_DRAG_TYPE = 'application/x-githuman-note'

export interface NoteDragPayload {
  noteId: string
  storageId: string
}

export function parseNoteDrag(value: string): NoteDragPayload | null {
  try {
    const data: unknown = JSON.parse(value)
    if (
      !data ||
      typeof data !== 'object' ||
      !('noteId' in data) ||
      !('storageId' in data)
    ) {
      return null
    }
    if (
      typeof data.noteId !== 'string' ||
      !data.noteId ||
      typeof data.storageId !== 'string' ||
      !data.storageId
    ) {
      return null
    }
    return { noteId: data.noteId, storageId: data.storageId }
  } catch {
    return null
  }
}

export function noteDropTarget(
  payload: NoteDragPayload,
  storageId: string | undefined,
  entries: readonly NoteEntry[],
  folder: string
): { path: string; target: string } | null {
  if (payload.storageId !== storageId) return null
  if (folder && !entries.some(entry => entry.folder && entry.path === folder)) {
    return null
  }
  const note = entries.find(
    entry => !entry.folder && entry.id === payload.noteId
  )
  if (!note) return null
  const name = noteBasename(note.path)
  const target = noteChildPath(folder, name)
  return target === note.path ? null : { path: note.path, target }
}
