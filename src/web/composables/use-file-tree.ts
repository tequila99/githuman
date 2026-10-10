import { computed, ref } from 'vue'
import { apiGet } from '@/api/client'
import { decodeGitPath } from '@/utils/git-path'
import type { FileTreeNode, FileTreeResponse } from '@/api/types'
import { errorMessage } from '@/utils/error-message'
import { buildTree } from '@/utils/file-tree'

export function useFileTree() {
  const tree = ref<FileTreeNode[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)
  // Spinner until the first answer, not only while a request runs: entering
  // browse fetches the diff first, and "No files" would flash meanwhile. A
  // refetch keeps the tree on screen.
  const initialLoading = computed(() => !loaded.value)

  // A slower, older request must not overwrite a newer answer.
  let latestRequestId = 0

  async function fetchTree(targetRef: string, changedFilePaths: string[] = []) {
    const requestId = ++latestRequestId
    loading.value = true

    try {
      const data = await apiGet<FileTreeResponse>(
        `/api/git/tree/${encodeURIComponent(targetRef)}`
      )
      if (requestId !== latestRequestId) return
      tree.value = buildTree(
        data.files.map(decodeGitPath),
        new Set(changedFilePaths)
      )
      // Cleared only on success, and the old tree kept on failure: a retry
      // must not blink the error away or empty the sidebar (#43, as #35).
      error.value = null
    } catch (e) {
      if (requestId !== latestRequestId) return
      error.value = errorMessage(e)
    } finally {
      if (requestId === latestRequestId) {
        loading.value = false
        loaded.value = true
      }
    }
  }

  function reset() {
    ++latestRequestId // an answer still in flight must not refill the state
    tree.value = []
    loading.value = false
    loaded.value = false
    error.value = null
  }

  return { tree, loading, initialLoading, error, fetchTree, reset }
}
