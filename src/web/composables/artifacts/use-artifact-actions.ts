import {
  shallowRef,
  watch,
  onUnmounted,
  toValue,
  type MaybeRefOrGetter
} from 'vue'
import { useAgentStore } from '@/stores/agent-store'
import {
  useArtifactActionsStore,
  type createArtifactActions
} from '@/stores/artifact-actions-store'
import { useServerEvents } from '@/composables/use-server-events'

export function useArtifactActions(storeId: MaybeRefOrGetter<string | null>) {
  const store = useArtifactActionsStore()
  const agent = useAgentStore()
  const actions = shallowRef<ReturnType<typeof createArtifactActions> | null>(
    null
  )
  watch(
    () => toValue(storeId),
    (id, _before, cleanup) => {
      actions.value = id ? store.forStore(id) : null
      if (actions.value) {
        const value = actions.value
        void value.start()
        cleanup(value.stop)
      }
    },
    { immediate: true }
  )
  watch(
    () => agent.artifactActionsVersion,
    () => {
      void actions.value?.invalidate()
    }
  )
  const events = useServerEvents(['artifacts:changed'], () => {
    void actions.value?.invalidate()
  })
  onUnmounted(events.close)
  return actions
}
