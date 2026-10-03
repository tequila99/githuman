import { onBeforeUnmount, onDeactivated } from 'vue'
import { useTimeout } from 'quasar'
import { apiGet } from '@/api/client'
import type { AgentFileSearchResponse } from '@/api/types'

// Keep file suggestions responsive without requesting every keystroke.
const SEARCH_DEBOUNCE_MS = 80
// Keep the popup short enough for keyboard navigation.
const SEARCH_LIMIT = 30

export function useMentionSearch(options: {
  onResult: (files: string[]) => void
  onError: () => void
}) {
  const { registerTimeout, removeTimeout } = useTimeout()
  let sequence = 0
  function cancel(): void {
    removeTimeout()
    sequence++
  }
  async function lookUp(query: string, seq: number): Promise<void> {
    try {
      const { files } = await apiGet<AgentFileSearchResponse>(
        `/api/agent/files?q=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}`
      )
      if (seq === sequence) options.onResult(files)
    } catch {
      if (seq === sequence) options.onError()
    }
  }
  function search(query: string): void {
    const seq = ++sequence
    registerTimeout(() => {
      void lookUp(query, seq)
    }, SEARCH_DEBOUNCE_MS)
  }
  onBeforeUnmount(cancel)
  onDeactivated(cancel)
  return { search, cancel }
}
