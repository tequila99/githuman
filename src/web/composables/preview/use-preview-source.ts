import { computed, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { usePreviewStore } from '@/stores/windows/preview-store'
import { useAgentStore } from '@/stores/agent-store'
import type { PreviewData, PreviewTab } from '@/types/windows/preview'

// A closed tab has no stored entry; this inert entry never triggers a load.
const CLOSED_ENTRY: PreviewData = {
  text: '',
  image: '',
  pdf: null,
  loading: false,
  error: null,
  missing: null,
  loaded: true,
  stale: false
}

export function usePreviewSource(
  tab: MaybeRefOrGetter<PreviewTab>,
  visible: MaybeRefOrGetter<boolean>
) {
  const preview = usePreviewStore()
  const agent = useAgentStore()
  const entry = computed(() => preview.data[toValue(tab).id] ?? CLOSED_ENTRY)
  const sourceVersion = computed(() => {
    const source = toValue(tab).source
    if (source.type !== 'message') return null
    const item = agent.chats[source.sessionId]?.chat.items.find(
      candidate => candidate.id === source.messageId
    )
    return item && 'text' in item ? item.text : item
  })
  watch(sourceVersion, () => {
    if (entry.value !== CLOSED_ENTRY) entry.value.stale = true
  })
  watch(
    () => [toValue(tab).id, toValue(visible), entry.value.stale],
    () => {
      if (
        toValue(visible) &&
        (entry.value.stale || !entry.value.loaded) &&
        (!entry.value.loading || entry.value.stale)
      )
        void preview.load(toValue(tab).id)
    },
    { immediate: true }
  )

  return { entry, reload: () => preview.load(toValue(tab).id) }
}
