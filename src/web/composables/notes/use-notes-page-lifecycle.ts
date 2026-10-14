import { onMounted, onBeforeUnmount } from 'vue'
import { useEventListener } from 'quasar'
import { onBeforeRouteLeave } from 'vue-router'
import type { useNotesStore } from '@/stores/notes-store'
import { useNoteAutosave } from '@/composables/use-note-autosave'
import { useServerEvents } from '@/composables/use-server-events'

export function useNotesPageLifecycle(store: ReturnType<typeof useNotesStore>) {
  const flush = useNoteAutosave()
  const events = useServerEvents(['notes:changed'], () => {
    void store.refresh()
  })
  useEventListener(window, 'beforeunload', (event: BeforeUnloadEvent) => {
    if (
      !Object.values(store.drafts).some(draft => draft.text !== draft.saved)
    ) {
      return
    }
    event.preventDefault()
    event.returnValue = ''
  })
  onMounted(() => {
    void store.refresh()
  })
  onBeforeUnmount(events.close)
  onBeforeRouteLeave(async () => await flush())
  return flush
}
