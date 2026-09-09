import { ref } from 'vue'
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
  const error = ref<string | null>(null)

  async function fetchTree(targetRef: string, changedFilePaths: string[] = []) {
    loading.value = true
    error.value = null

    try {
      const data = await apiGet<FileTreeResponse>(
        `/api/git/tree/${encodeURIComponent(targetRef)}`
      )
      tree.value = buildTree(
        data.files.map(decodeGitPath),
        new Set(changedFilePaths)
      )
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      tree.value = []
    } finally {
      loading.value = false
    }
  }

  return { tree, loading, error, fetchTree }
}
