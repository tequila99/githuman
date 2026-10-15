import { noteBasename } from '../../../shared/notes/note-path.ts'
import { useEventListener } from 'quasar'
import { shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotesStore } from '@/stores/notes-store'
import { useNotifyError } from '@/composables/use-notify-error'
import {
  NOTE_DRAG_TYPE,
  parseNoteDrag,
  noteDropTarget
} from '@/utils/notes/drag-drop'

export function useNoteDragDrop() {
  const notes = useNotesStore()
  const { t } = useI18n()
  const notifyError = useNotifyError()
  const hovered = shallowRef<string | null>(null)
  const busy = shallowRef(false)
  useEventListener(document, 'dragend', () => {
    hovered.value = null
  })
  function start(event: DragEvent, path: string) {
    const note = notes.index.entries.find(
      entry => entry.path === path && !entry.folder
    )
    if (!event.dataTransfer || !note?.id || !notes.index.storageId) {
      event.preventDefault()
      return
    }
    event.stopPropagation()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(
      NOTE_DRAG_TYPE,
      JSON.stringify({ noteId: note.id, storageId: notes.index.storageId })
    )
  }
  function over(event: DragEvent, folder: string) {
    if (busy.value || !event.dataTransfer?.types.includes(NOTE_DRAG_TYPE)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    hovered.value = folder
  }
  function leave(event: DragEvent) {
    if (
      event.currentTarget instanceof Element &&
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return
    }
    hovered.value = null
  }
  async function drop(event: DragEvent, folder: string) {
    hovered.value = null
    if (!event.dataTransfer?.types.includes(NOTE_DRAG_TYPE)) return
    event.preventDefault()
    event.stopPropagation()
    if (busy.value) return
    const payload = parseNoteDrag(event.dataTransfer.getData(NOTE_DRAG_TYPE))
    if (!payload) return
    const move = noteDropTarget(
      payload,
      notes.index.storageId,
      notes.index.entries,
      folder
    )
    if (!move) return
    busy.value = true
    try {
      if (
        !(await notes.rename(
          move.path,
          noteBasename(move.path),
          false,
          move.target,
          payload.noteId
        ))
      ) {
        notifyError(t('notes.moveFailed'), notes.error)
      }
    } catch (error) {
      notifyError(t('notes.moveFailed'), error)
    } finally {
      busy.value = false
    }
  }
  return {
    hovered,
    start,
    over,
    leave,
    drop,
    end: () => {
      hovered.value = null
    }
  }
}
