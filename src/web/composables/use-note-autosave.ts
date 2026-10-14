import { watch, onBeforeUnmount } from 'vue'
import { useTimeout } from 'quasar'
import { useNotesStore } from '@/stores/notes-store'

// A short pause combines adjacent keystrokes into one disk write.
const SAVE_DELAY_MS = 500
export function useNoteAutosave() {
  const store = useNotesStore()
  const { registerTimeout, removeTimeout } = useTimeout()
  watch(
    () => store.current?.text,
    () => {
      const path = store.selectedId
      registerTimeout(() => {
        void store.save(path)
      }, SAVE_DELAY_MS)
    }
  )
  onBeforeUnmount(() => {
    removeTimeout()
    void store.save()
  })
  return async () => {
    removeTimeout()
    return store.save()
  }
}
