import { computed, onUnmounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useEventListener, useTimeout } from 'quasar'
import { useAgentStore } from '@/stores/agent-store'
import { useArtifactActionsStore } from '@/stores/artifact-actions-store'
import { useServerEvents } from '@/composables/use-server-events'

// Upper bound of one timer: setTimeout overflows above 2^31 ms.
const MAX_TIMER_MS = 2_147_483_647

/**
 * The single owner of the pending-action queue (ADR 0116). Mount it once in
 * the layout. It reads the queue without the artifact catalog and refreshes it
 * from the existing agent stream and server events: it opens no new transport.
 */
export function useArtifactActions() {
  const store = useArtifactActionsStore()
  const agent = useAgentStore()
  const { model, loading, error } = storeToRefs(store)
  const { registerTimeout, removeTimeout } = useTimeout()

  function invalidate() {
    void model.value?.invalidate()
  }
  function scheduleExpiry() {
    removeTimeout()
    const value = model.value
    const at = value?.nextExpiry()
    if (!value || at === null || at === undefined) return
    registerTimeout(
      () => {
        // Drop confirmation first, then ask the server what is left.
        value.expire()
        invalidate()
      },
      Math.min(Math.max(at - Date.now(), 0), MAX_TIMER_MS)
    )
  }

  void store.bootstrap()
  watch(
    () => agent.artifactActionsVersion,
    () => invalidate()
  )
  // A closed chat removes its requests without an artifact-actions event.
  watch(
    () => Object.keys(agent.chats).join(),
    () => invalidate()
  )
  watch(
    () => [
      model.value,
      model.value?.state.items,
      model.value?.state.inspection
    ],
    scheduleExpiry,
    { immediate: true }
  )
  useEventListener(document, 'visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (!model.value) void store.bootstrap()
    model.value?.expire()
    invalidate()
  })
  const events = useServerEvents(['artifacts:changed'], invalidate)
  onUnmounted(() => {
    events.close()
    store.dispose()
  })

  const count = computed(() => model.value?.state.items.length ?? 0)
  return {
    model,
    count,
    loading,
    error,
    retry: () => (model.value ? model.value.invalidate() : store.bootstrap())
  }
}
