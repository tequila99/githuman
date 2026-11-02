import { noteBasename } from '../../../shared/notes/note-path.ts'
import { notesApi } from '@/api/notes'
import { useNotesStore } from '@/stores/notes-store'
import { useAddAgentContext } from '@/composables/use-add-agent-context'
import type { AgentContextItem } from '@/api/types'

export function useNoteAgentContext() {
  const notes = useNotesStore()
  return async (path: string): Promise<AgentContextItem> => {
    if (!(await notes.save(path))) throw new Error('Could not save the note')
    const note = await notesApi.read(path)
    if (!note.id || !note.storageId) {
      throw new Error('Note identity is unavailable')
    }
    return {
      kind: 'note',
      noteId: note.id,
      storageId: note.storageId,
      name: noteBasename(note.path)
    }
  }
}

export function useAddNoteToAgent() {
  const context = useNoteAgentContext()
  const add = useAddAgentContext()
  return (path: string) => add(() => context(path))
}
