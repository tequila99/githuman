import { registerArtifactRefresh } from './artifact-refresh'
import { watch, onUnmounted, type MaybeRefOrGetter, toValue } from 'vue'
import { useServerEvents } from '@/composables/use-server-events'
import { usePaneVisibility } from '@/composables/use-pane-visibility'

export function useArtifactDetailPage<
  Resource extends {
    setActive: (visible: boolean) => Promise<void>
    invalidate: () => Promise<void>
    dispose: () => void
  }
>(resource: Resource, open: MaybeRefOrGetter<boolean>): Resource {
  registerArtifactRefresh(resource.invalidate)
  const paneVisible = usePaneVisibility()
  watch(
    () => toValue(open) && paneVisible(),
    visible => {
      void resource.setActive(visible)
    },
    { immediate: true }
  )
  const events = useServerEvents(['artifacts:changed'], () => {
    void resource.invalidate()
  })
  onUnmounted(() => {
    events.close()
    resource.dispose()
  })
  return resource
}
