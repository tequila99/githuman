import { computed, onScopeDispose, shallowRef } from 'vue'
import { debounce } from 'quasar'
import { useArtifactDefinitionsStore } from '@/stores/artifact-definitions-store'

// Wait for a pause in typing before the server search request.
const SEARCH_DEBOUNCE_MS = 250

/** Searches open tasks. The search page exists only while the caller keeps it open. */
export function useTaskSearch(storeId: () => string | null) {
  const store = useArtifactDefinitionsStore()
  const catalog = shallowRef<ReturnType<
    ReturnType<typeof store.forStore>['openSearch']
  > | null>(null)
  const items = computed(() => catalog.value?.state.page?.items ?? [])
  const loading = computed(() => catalog.value?.state.loading ?? false)
  const error = computed(() => catalog.value?.state.error ?? null)
  const applyText = debounce((value: string) => {
    void catalog.value?.setText(value)
  }, SEARCH_DEBOUNCE_MS)

  function open() {
    const id = storeId()
    if (catalog.value || !id) return
    catalog.value = store.forStore(id).openSearch('task', { state: 'open' })
  }
  function close() {
    applyText.cancel()
    catalog.value?.close()
    catalog.value = null
  }
  function search(value: string) {
    applyText(value.trim())
  }
  // Load the next page when the last item becomes visible.
  function more() {
    const current = catalog.value
    if (
      !current?.state.page?.nextCursor ||
      current.state.loading ||
      current.state.stale
    ) {
      return Promise.resolve()
    }
    return current.more()
  }
  function retry() {
    return catalog.value?.refresh()
  }
  onScopeDispose(close)
  return { items, loading, error, open, close, search, more, retry }
}
