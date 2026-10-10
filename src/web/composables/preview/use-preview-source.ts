import { computed, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { usePreviewStore } from '@/stores/windows/preview-store'
import { useAgentStore } from '@/stores/agent-store'
import type { PreviewTab } from '@/types/windows/preview'

export function usePreviewSource(
  tab: MaybeRefOrGetter<PreviewTab>,
  visible: MaybeRefOrGetter<boolean>
) {
  const preview = usePreviewStore()
  const agent = useAgentStore()
  const entry = computed(() => preview.runtime(toValue(tab).id))
  const sourceVersion = computed(() => {
    const source = toValue(tab).source
    if (source.type !== 'message') return null
    const item = agent.chats[source.sessionId]?.chat.items.find(
      candidate => candidate.id === source.messageId
    )
    return item && 'text' in item ? item.text : item
  })
  watch(sourceVersion, () => {
    entry.value.stale = true
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
