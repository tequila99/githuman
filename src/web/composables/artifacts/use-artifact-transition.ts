import {
  computed,
  onUnmounted,
  toValue,
  watch,
  type MaybeRefOrGetter
} from 'vue'
import { registerArtifactRefresh } from '@/composables/artifacts/artifact-refresh'
import { useArtifactTransitionStore } from '@/stores/artifact-transition-store'
import { useServerEvents } from '@/composables/use-server-events'

/** Observes the status menu data and the running operation of one artifact. */
export function useArtifactTransition(artifactId: MaybeRefOrGetter<string>) {
  const store = useArtifactTransitionStore()
  watch(
    () => toValue(artifactId),
    (id, previous) => {
      if (previous) {
        store.release(previous)
      }
      void store.load(id)
    },
    { immediate: true }
  )
  // Every stage change bumps the store epoch, so one event type covers all.
  const events = useServerEvents(['artifacts:changed'], () => {
    void store.load(toValue(artifactId))
  })
  // The shared Refresh of the document pane also rereads the menu and the operation.
  registerArtifactRefresh(() => store.load(toValue(artifactId)))
  onUnmounted(() => {
    events.close()
    store.release(toValue(artifactId))
  })
  const entry = computed(() => store.entry(toValue(artifactId)))
  return { entry, store }
}
