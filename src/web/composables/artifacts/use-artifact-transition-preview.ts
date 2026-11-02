import {
  onUnmounted,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter
} from 'vue'
import { useTimeout } from 'quasar'
import { useArtifactTransitionStore } from '@/stores/artifact-transition-store'
import { useServerEvents } from '@/composables/use-server-events'
import { errorMessage } from '@/utils/error-message'
import type { Artifact, ArtifactTransitionPreview } from '@/api/types'

export function useArtifactTransitionPreview(
  artifactId: MaybeRefOrGetter<string>,
  target: MaybeRefOrGetter<Artifact['status'] | null>,
  open: MaybeRefOrGetter<boolean>,
  submitting: MaybeRefOrGetter<boolean>
) {
  const store = useArtifactTransitionStore()
  const { registerTimeout, removeTimeout } = useTimeout()
  const preview = shallowRef<ArtifactTransitionPreview | null>(null)
  const loading = shallowRef(false)
  const expired = shallowRef(false)
  const refreshed = shallowRef(false)
  const error = shallowRef<string | null>(null)
  let generation = 0
  let controller: AbortController | null = null

  async function load(afterChange = false) {
    const status = toValue(target)
    if (!toValue(open) || !status) return
    const current = ++generation
    controller?.abort()
    const request = new AbortController()
    controller = request
    loading.value = true
    error.value = null
    expired.value = false
    removeTimeout()
    try {
      const result = await store.previewFor(
        toValue(artifactId),
        status,
        request.signal
      )
      if (current !== generation) return
      preview.value = result
      refreshed.value = afterChange
      registerTimeout(
        () => {
          expired.value = true
        },
        Math.max(0, result.expiresAt - Date.now())
      )
    } catch (cause) {
      if (current === generation) {
        preview.value = null
        error.value = errorMessage(cause)
      }
    } finally {
      if (current === generation) loading.value = false
    }
  }

  function reset() {
    ++generation
    controller?.abort()
    removeTimeout()
    preview.value = null
    loading.value = false
    expired.value = false
    refreshed.value = false
    error.value = null
  }

  watch(
    [() => toValue(open), () => toValue(artifactId), () => toValue(target)],
    () => {
      reset()
      if (toValue(open)) void load()
    },
    { immediate: true }
  )
  const events = useServerEvents(['artifacts:changed'], () => {
    if (toValue(open) && !toValue(submitting)) void load(true)
  })
  onUnmounted(() => {
    events.close()
    reset()
  })
  return { preview, loading, expired, refreshed, error, load }
}
