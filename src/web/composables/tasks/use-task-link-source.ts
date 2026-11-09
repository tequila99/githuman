import { onBeforeUnmount, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { debounce, useQuasar } from 'quasar'
import { ARTIFACT_STATUSES } from '../../../shared/artifacts/constants.ts'
import { noteLink, resolveNoteLink } from '../../../shared/notes/links.ts'
import { noteTitle } from '../../../shared/notes/note-path.ts'
import { artifactsApi } from '@/api/artifacts'
import { notesApi } from '@/api/notes'
import { useNotesStore } from '@/stores/notes-store'
import { errorMessage } from '@/utils/error-message'
import type { EditorLinkSource, EditorLinkTarget } from '@/utils/editor-links'

// A task is not a file; links to notes count from the notes root.
const NOTES_BASE_PATH = 'task.md'
// Hash-router address of the artifact page, as in the links the agent cites.
const ARTIFACT_LINK_PREFIX = '/#/'
// Short lists keep the popup usable; the picker narrows further as the user types.
const MAX_SUGGESTIONS = 8
// Waits for typing to pause before the server search runs.
const SEARCH_DELAY_MS = 250

/** Suggestions for notes and artifacts, and the navigation behind their links. */
export function useTaskLinkSource(): EditorLinkSource & {
  follow: (href: string) => Promise<void>
} {
  const router = useRouter()
  const $q = useQuasar()
  const notes = useNotesStore()
  const matches = shallowRef<readonly EditorLinkTarget[]>([])
  // A late answer to an older query must not replace the current list.
  let generation = 0

  function noteMatches(text: string): EditorLinkTarget[] {
    const needle = text.toLocaleLowerCase()
    return notes.index.entries
      .filter(
        entry =>
          !entry.folder &&
          entry.presence !== 'deleted' &&
          entry.path.toLocaleLowerCase().includes(needle)
      )
      .slice(0, MAX_SUGGESTIONS)
      .map(entry => ({
        key: 'note:' + entry.path,
        label: noteTitle(entry.path),
        caption: entry.path,
        href: noteLink(NOTES_BASE_PATH, entry.path)
      }))
  }
  async function search(text: string) {
    const mine = ++generation
    if (!notes.index.entries.length) await notes.refresh()
    if (mine !== generation) return
    const local = noteMatches(text)
    matches.value = local
    try {
      const result = await artifactsApi.search({
        query: text,
        filters: { statuses: [...ARTIFACT_STATUSES] },
        limit: MAX_SUGGESTIONS
      })
      if (mine !== generation) return
      matches.value = [
        ...local,
        ...result.items.map(item => ({
          key: 'artifact:' + item.id,
          artifact: item,
          label: item.title,
          caption: `${item.typeId} · ${item.status}`,
          href:
            ARTIFACT_LINK_PREFIX +
            'artifacts?storeId=' +
            encodeURIComponent(item.storeId) +
            '&selectedId=' +
            encodeURIComponent(item.id)
        }))
      ]
    } catch {
      // Notes stay available when the artifact search fails.
    }
  }
  const delayedSearch = debounce(search, SEARCH_DELAY_MS)
  onBeforeUnmount(() => {
    delayedSearch.cancel()
    generation++
  })

  function setQuery(next: string | null) {
    if (next === null) {
      delayedSearch.cancel()
      generation++
      matches.value = []
      return
    }
    matches.value = noteMatches(next)
    delayedSearch(next)
  }
  async function follow(href: string) {
    try {
      if (href.startsWith(ARTIFACT_LINK_PREFIX)) {
        await router.push(href.slice(ARTIFACT_LINK_PREFIX.length - 1))
        return
      }
      const target = resolveNoteLink(NOTES_BASE_PATH, href)
      if (!target) return
      const record = await notesApi.resolvePath(target.path)
      if (!notes.index.storageId) await notes.refresh()
      const storageId = notes.index.storageId
      if (!storageId) throw new Error('Notes storage is unavailable.')
      await router.push({
        name: 'note-document',
        params: { storageId, id: record.id }
      })
    } catch (error) {
      $q.notify({ type: 'negative', message: errorMessage(error) })
    }
  }
  return { matches, setQuery, follow }
}
