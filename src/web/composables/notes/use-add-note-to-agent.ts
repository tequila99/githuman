import { noteBasename } from '../../../shared/notes/note-path.ts'
import { useQuasar } from 'quasar'
import { notesApi } from '@/api/notes'
import { useNotesStore } from '@/stores/notes-store'
import { useAddAgentContext } from '@/composables/use-add-agent-context'
import { errorMessage } from '@/utils/error-message'

export function useAddNoteToAgent() {
  const notes = useNotesStore()
  const add = useAddAgentContext()
  const $q = useQuasar()
  return async (path: string) => {
    try {
      if (!(await notes.save(path))) throw new Error('Could not save the note')
      const note = await notesApi.read(path)
      if (!note.id || !note.storageId) {
        throw new Error('Note identity is unavailable')
      }
      add({
        kind: 'note',
        noteId: note.id,
        storageId: note.storageId,
        name: noteBasename(note.path)
      })
    } catch (error) {
      $q.notify({ type: 'negative', message: errorMessage(error) })
    }
  }
}
