import { noteParentPath } from '../../../shared/notes/note-path.ts'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useNotesStore } from '@/stores/notes-store'
import { useNotifyError } from '@/composables/use-notify-error'

export function useDeleteNote() {
  const notes = useNotesStore()
  const router = useRouter()
  const { t } = useI18n()
  const notifyError = useNotifyError()
  return async (path: string) => {
    const selected = notes.selected === path
    if (!(await notes.remove(path))) {
      notifyError(t('notes.deleteFailed'), notes.error)
      return
    }
    if (selected && !notes.selectedId) {
      await router.replace({
        name: 'notes',
        query: { folder: noteParentPath(path) }
      })
    }
  }
}
