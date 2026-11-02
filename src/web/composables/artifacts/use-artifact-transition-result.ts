import {
  onUnmounted,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter
} from 'vue'
import { artifactActionsApi } from '@/api/artifact-actions'
import { artifactsApi } from '@/api/artifacts'
import { errorMessage } from '@/utils/error-message'
import { readArtifactValidationReport } from '@/utils/artifact-validation-report'

// Titles are looked up for at most this many distinct documents.
const MAX_TITLE_LOOKUPS = 20

type Report = Awaited<ReturnType<typeof readArtifactValidationReport>>

export function useArtifactTransitionResult(
  validationId: MaybeRefOrGetter<string | null>,
  open: MaybeRefOrGetter<boolean>
) {
  const report = shallowRef<Report>(null)
  const titles = shallowRef<Record<string, string>>({})
  const loading = shallowRef(false)
  const error = shallowRef<string | null>(null)
  let generation = 0
  let controller: AbortController | null = null

  async function load() {
    const id = toValue(validationId)
    if (!toValue(open) || !id) return
    controller?.abort()
    const request = new AbortController()
    controller = request
    const current = ++generation
    loading.value = true
    error.value = null
    try {
      const view = await artifactActionsApi.validationView(id, request.signal)
      request.signal.throwIfAborted()
      const result = await readArtifactValidationReport(view, request.signal)
      if (current !== generation) return
      report.value = result
      const ids = [...new Set(result?.findings.map(item => item.artifactId))]
      const found = await Promise.allSettled(
        ids
          .slice(0, MAX_TITLE_LOOKUPS)
          .map(artifactId => artifactsApi.get(artifactId, request.signal))
      )
      if (current === generation) {
        titles.value = Object.fromEntries(
          found.flatMap(item =>
            item.status === 'fulfilled'
              ? [[item.value.id, item.value.title]]
              : []
          )
        )
      }
    } catch (cause) {
      if (current === generation && !request.signal.aborted) {
        error.value = errorMessage(cause)
      }
    } finally {
      if (current === generation) loading.value = false
    }
  }

  function reset() {
    ++generation
    controller?.abort()
    report.value = null
    titles.value = {}
    loading.value = false
    error.value = null
  }

  watch(
    [() => toValue(open), () => toValue(validationId)],
    () => {
      reset()
      if (toValue(open)) void load()
    },
    { immediate: true }
  )
  onUnmounted(reset)
  return { report, titles, loading, error, load }
}
