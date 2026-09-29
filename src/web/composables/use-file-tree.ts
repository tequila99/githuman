import { computed, ref } from 'vue'
import { apiGet } from '@/api/client'
import { decodeGitPath } from '@/utils/git-path'
import type { FileTreeNode, FileTreeResponse } from '@/api/types'

function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes
    .toSorted((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    .map(node => ({
      ...node,
      children: node.children ? sortNodes(node.children) : undefined
    }))
}

/** Builds a nested tree from a flat list of file paths, directories first, then alphabetically. */
export function buildTree(
  files: string[],
  changedFiles: Set<string>
): FileTreeNode[] {
  const root: FileTreeNode[] = []

  for (const filePath of files) {
    const parts = filePath.split('/')
    let currentLevel = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!part) continue

      const isFile = i === parts.length - 1
      const currentPath = parts.slice(0, i + 1).join('/')

      let node = currentLevel.find(n => n.name === part)

      if (!node) {
        node = {
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
          isChanged: isFile ? changedFiles.has(filePath) : false,
          children: isFile ? undefined : []
        }
        currentLevel.push(node)
      }

      if (!isFile && node.children) {
        currentLevel = node.children
      }
    }
  }

  return sortNodes(root)
}

/** Filters a tree to nodes whose path (file) or name (directory) matches the query. */
export function filterTree(
  nodes: FileTreeNode[],
  query: string
): FileTreeNode[] {
  if (!query.trim()) return nodes
  const lowerQuery = query.toLowerCase()

  const filterNode = (node: FileTreeNode): FileTreeNode | null => {
    if (node.type === 'file') {
      return node.path.toLowerCase().includes(lowerQuery) ? node : null
    }

    const filteredChildren = node.children
      ?.map(filterNode)
      .filter((n): n is FileTreeNode => n !== null)

    if (filteredChildren && filteredChildren.length > 0) {
      return { ...node, children: filteredChildren }
    }

    return node.name.toLowerCase().includes(lowerQuery) ? node : null
  }

  return nodes.map(filterNode).filter((n): n is FileTreeNode => n !== null)
}

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
      error.value = e instanceof Error ? e.message : String(e)
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
