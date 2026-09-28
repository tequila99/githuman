import { defineStore, acceptHMRUpdate } from 'pinia'
import { computed, nextTick, ref, watch } from 'vue'
import { useDiffStore, type DiffSource } from './diff-store'
import { useFileTree, filterTree } from '@/composables/use-file-tree'
import { useFileContent } from '@/composables/use-file-content'
import { pathOf } from '@/utils/diff-file'
import type { DiffFile, FileTreeNode } from '@/api/types'

function hasRelevantChild(node: FileTreeNode): boolean {
  if (node.type === 'file') return node.isChanged
  return node.children?.some(hasRelevantChild) ?? false
}

export const useFileExplorerStore = defineStore('file-explorer', () => {
  const diffStore = useDiffStore()
  const { tree, loading: treeLoading, fetchTree } = useFileTree()
  const {
    lines: browseFileLines,
    isBinary: browseFileIsBinary,
    loading: browseFileLoading,
    fetchContent: fetchBrowseFileContent,
    reset: resetBrowseFileContent
  } = useFileContent()

  const source = ref<DiffSource>('staged')
  const browseMode = ref(false)
  const filter = ref<string | null>('')
  const selectedPath = ref<string | null>(null)
  const expandedFolders = ref<Set<string>>(new Set())
  const expandedFiles = ref<Set<string>>(new Set())

  const diffFiles = computed<DiffFile[]>(() =>
    source.value === 'staged' ? diffStore.stagedFiles : diffStore.unstagedFiles
  )

  const filteredDiffFiles = computed(() => {
    const query = (filter.value ?? '').trim().toLowerCase()
    if (!query) return diffFiles.value
    return diffFiles.value.filter(file =>
      pathOf(file).toLowerCase().includes(query)
    )
  })

  const filteredTree = computed(() =>
    filterTree(tree.value, filter.value ?? '')
  )

  const totalTreeFiles = computed(() => {
    let count = 0
    const walk = (nodes: FileTreeNode[]) => {
      for (const node of nodes) {
        if (node.type === 'file') count++
        else if (node.children) walk(node.children)
      }
    }
    walk(tree.value)
    return count
  })

  watch(
    tree,
    nodes => {
      const foldersToExpand = new Set<string>()
      const visit = (items: FileTreeNode[]) => {
        for (const node of items) {
          if (node.type === 'directory' && node.children) {
            if (hasRelevantChild(node)) foldersToExpand.add(node.path)
            visit(node.children)
          }
        }
      }
      visit(nodes)
      expandedFolders.value = foldersToExpand
    },
    { immediate: true }
  )

  watch(browseMode, enabled => {
    filter.value = ''
    selectedPath.value = null
    if (enabled) void fetchTree('WORKTREE', diffStore.changedPaths)
  })

  watch(source, () => {
    selectedPath.value = null
    expandedFiles.value = new Set()
  })

  watch(selectedPath, path => {
    if (!browseMode.value) return
    if (!path) {
      resetBrowseFileContent()
      return
    }
    void fetchBrowseFileContent(path, 'WORKTREE')
  })

  function toggleFolder(path: string) {
    const next = new Set(expandedFolders.value)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    expandedFolders.value = next
  }

  function toggleFileCard(path: string) {
    const next = new Set(expandedFiles.value)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    expandedFiles.value = next
  }

  function handleCardToggle(path: string) {
    selectedPath.value = path
    toggleFileCard(path)
  }

  function expandFile(path: string) {
    selectedPath.value = path
    if (!expandedFiles.value.has(path)) {
      expandedFiles.value = new Set(expandedFiles.value).add(path)
    }
  }

  function expandAllFiles() {
    expandedFiles.value = new Set(diffFiles.value.map(pathOf))
  }

  function collapseAllFiles() {
    expandedFiles.value = new Set()
  }

  function selectFile(path: string) {
    selectedPath.value = path
    if (browseMode.value) return

    if (!expandedFiles.value.has(path)) {
      expandedFiles.value = new Set(expandedFiles.value).add(path)
    }
    void nextTick(() => {
      document.getElementById(`diff-file-${path}`)?.scrollIntoView({
        block: 'nearest'
      })
    })
  }

  // file-watcher.service.ts debounces this long before emitting `files:changed` after a git
  // mutation, so an explicit refresh() is reliably followed by a same-mutation SSE echo within
  // this window.
  const REFRESH_ECHO_WINDOW_MS = 400

  let pendingRefresh: Promise<void> | null = null
  let refreshedAt = 0

  /** Coalesces overlapping calls into a single in-flight fetch. */
  function doRefresh(): Promise<void> {
    return (pendingRefresh ??= (async () => {
      await diffStore.fetchDiff()
      if (browseMode.value) {
        await fetchTree('WORKTREE', diffStore.changedPaths)
        if (selectedPath.value) {
          await fetchBrowseFileContent(selectedPath.value, 'WORKTREE')
        }
      }
    })().finally(() => {
      pendingRefresh = null
    }))
  }

  /** Always fetches. Call after anything the UI itself just did (mount, stage/unstage/discard). */
  async function refresh() {
    refreshedAt = Date.now()
    await doRefresh()
  }

  /** Fetches on a 'files:changed' SSE event, unless it's an echo of our own recent refresh(). */
  async function refreshFromServerEvent() {
    if (Date.now() - refreshedAt < REFRESH_ECHO_WINDOW_MS) return
    await doRefresh()
  }

  return {
    source,
    browseMode,
    filter,
    selectedPath,
    expandedFolders,
    expandedFiles,
    tree,
    treeLoading,
    browseFileLines,
    browseFileIsBinary,
    browseFileLoading,
    diffFiles,
    filteredDiffFiles,
    filteredTree,
    totalTreeFiles,
    toggleFolder,
    toggleFileCard,
    handleCardToggle,
    expandFile,
    expandAllFiles,
    collapseAllFiles,
    selectFile,
    refresh,
    refreshFromServerEvent
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useFileExplorerStore, import.meta.hot))
}
