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
import {
  readArtifactValidationReport,
  readArtifactValidationReportText
} from '@/utils/artifact-validation-report'

// Titles are looked up for at most this many distinct documents.
const MAX_TITLE_LOOKUPS = 20

type Report = Awaited<ReturnType<typeof readArtifactValidationReport>>

export function useArtifactTransitionResult(
  validationId: MaybeRefOrGetter<string | null>,
  open: MaybeRefOrGetter<boolean>
) {
  const report = shallowRef<Report>(null)
  const text = shallowRef<string | null>(null)
  const titles = shallowRef<Record<string, string>>({})
  const loading = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const textError = shallowRef<string | null>(null)
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
    textError.value = null
    try {
      const view = await artifactActionsApi.validationView(id, request.signal)
      request.signal.throwIfAborted()
      // Separate loads: a failed report text must not hide the findings.
      const [result, markdown] = await Promise.allSettled([
        readArtifactValidationReport(view, request.signal),
        readArtifactValidationReportText(view, request.signal)
      ])
      if (current !== generation) return
      if (result.status === 'rejected') throw result.reason
      report.value = result.value
      if (markdown.status === 'fulfilled') {
        text.value = markdown.value
      } else if (!request.signal.aborted) {
        textError.value = errorMessage(markdown.reason)
      }
      const ids = [
        ...new Set(result.value?.findings.map(item => item.artifactId))
      ]
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
    text.value = null
    titles.value = {}
    loading.value = false
    error.value = null
    textError.value = null
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
  return { report, text, titles, loading, error, textError, load }
}
