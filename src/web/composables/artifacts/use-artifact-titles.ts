import {
  onUnmounted,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter
} from 'vue'
import { artifactsApi } from '@/api/artifacts'

// Titles are looked up for at most this many distinct documents.
const MAX_TITLE_LOOKUPS = 20

/**
 * Titles of documents the caller does not know yet. A failed lookup leaves the
 * title out, and the caller then shows the identifier.
 */
export function useArtifactTitles(ids: MaybeRefOrGetter<string[]>) {
  const titles = shallowRef<Record<string, string>>({})
  let controller: AbortController | null = null

  watch(
    () => toValue(ids).join(','),
    async () => {
      const missing = [...new Set(toValue(ids))]
        .filter(id => !(id in titles.value))
        .slice(0, MAX_TITLE_LOOKUPS)
      controller?.abort()
      if (missing.length === 0) return
      const request = new AbortController()
      controller = request
      const found = await Promise.allSettled(
        missing.map(id => artifactsApi.get(id, request.signal))
      )
      if (request.signal.aborted) return
      titles.value = {
        ...titles.value,
        ...Object.fromEntries(
          found.flatMap(item =>
            item.status === 'fulfilled'
              ? [[item.value.id, item.value.title]]
              : []
          )
        )
      }
    },
    { immediate: true }
  )
  onUnmounted(() => controller?.abort())
  return titles
}
