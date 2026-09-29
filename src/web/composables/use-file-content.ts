import { ref } from 'vue'
import { apiGet } from '@/api/client'
import type { FileContentResponse } from '@/api/types'

export function useFileContent() {
  const lines = ref<string[]>([])
  const isBinary = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Guards against out-of-order responses: if the user switches files twice
  // in quick succession, only the reply to the *latest* fetchContent call is
  // allowed to commit into state — an earlier, slower request landing after
  // it would otherwise overwrite the correct content with a stale file's.
  let latestRequestId = 0
  let lastPath: string | null = null

  async function fetchContent(filePath: string, targetRef: string) {
    const requestId = ++latestRequestId
    loading.value = true
    // Another file: drop the old one's lines and error. The same file (a
    // refetch): keep both until the answer, so nothing blinks (#43).
    if (filePath !== lastPath) {
      reset()
      lastPath = filePath
    }

    try {
      const encodedPath = filePath.split('/').map(encodeURIComponent).join('/')
      const data = await apiGet<FileContentResponse>(
        `/api/git/file/${encodedPath}?ref=${encodeURIComponent(targetRef)}`
      )
      if (requestId !== latestRequestId) return
      lines.value = data.lines
      isBinary.value = data.isBinary
      error.value = null
    } catch (e) {
      if (requestId !== latestRequestId) return
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (requestId === latestRequestId) {
        loading.value = false
      }
    }
  }

  function reset() {
    lastPath = null
    lines.value = []
    isBinary.value = false
    error.value = null
  }

  return { lines, isBinary, loading, error, fetchContent, reset }
}
