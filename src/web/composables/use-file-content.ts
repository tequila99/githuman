import { ref, shallowRef } from 'vue'
import { apiGet } from '@/api/client'
import type { FileContentResponse } from '@/api/types'
import { errorMessage } from '@/utils/error-message'
import { createWeightedLru } from '@/utils/weighted-lru'
import { equalArrays } from '@/utils/equal-arrays'

// Lines kept by the content cache. The cache is per module, so it outlives a component:
// the virtual list unmounts a card that leaves the window, and the card must come back
// with its lines at once, so its height does not jump while the file loads again.
const CONTENT_CACHE_MAX_LINES = 100_000

type CachedContent = Pick<FileContentResponse, 'lines' | 'isBinary'>

const contentCache = createWeightedLru<string, CachedContent>(
  CONTENT_CACHE_MAX_LINES,
  data => data.lines.length + 1
)

/**
 * `cache`: show the last read of a file at once and refresh it in the background.
 * Without it, a new file starts empty, as before.
 */
export function useFileContent(options: { cache?: boolean } = {}) {
  // Shallow: the array is replaced, never changed in place. A deep proxy cannot go to the
  // highlight worker, and it costs time on large files.
  const lines = shallowRef<string[]>([])
  const isBinary = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Guards against out-of-order responses: if the user switches files twice
  // in quick succession, only the reply to the *latest* fetchContent call is
  // allowed to commit into state — an earlier, slower request landing after
  // it would otherwise overwrite the correct content with a stale file's.
  let latestRequestId = 0
  let lastKey: string | null = null

  async function fetchContent(filePath: string, targetRef: string) {
    // Another file or ref: drop the old lines and error. The same one (a
    // refetch): keep both until the answer, so nothing blinks (#43).
    const key = `${targetRef}:${filePath}`
    if (key !== lastKey) {
      reset()
      lastKey = key
      const cached = options.cache ? contentCache.get(key) : undefined
      if (cached) {
        lines.value = cached.lines
        isBinary.value = cached.isBinary
      }
    }
    const requestId = ++latestRequestId
    loading.value = true

    try {
      const encodedPath = filePath.split('/').map(encodeURIComponent).join('/')
      const data = await apiGet<FileContentResponse>(
        `/api/git/file/${encodedPath}?ref=${encodeURIComponent(targetRef)}`
      )
      if (requestId !== latestRequestId) return
      // The same text keeps the same array. The array is the key of the token cache,
      // so a refetch after an edit of another file does not color the lines again.
      if (!equalArrays(lines.value, data.lines)) lines.value = data.lines
      isBinary.value = data.isBinary
      error.value = null
      if (options.cache) {
        // Also for the same text: the entry may have left the cache.
        contentCache.set(key, { lines: lines.value, isBinary: data.isBinary })
      }
    } catch (e) {
      if (requestId !== latestRequestId) return
      error.value = errorMessage(e)
    } finally {
      if (requestId === latestRequestId) {
        loading.value = false
      }
    }
  }

  function reset() {
    ++latestRequestId // an answer still in flight must not refill the state
    loading.value = false
    lastKey = null
    lines.value = []
    isBinary.value = false
    error.value = null
  }

  return { lines, isBinary, loading, error, fetchContent, reset }
}
