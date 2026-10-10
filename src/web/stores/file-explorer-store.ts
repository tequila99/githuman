import { defineStore, acceptHMRUpdate } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useDiffStore, type DiffSource } from './diff-store'
import { useFileTree } from '@/composables/use-file-tree'
import {
  buildTree,
  filterTree,
  flattenTree,
  type TreeRow
} from '@/utils/file-tree'
import { useFileContent } from '@/composables/use-file-content'
import { pathOf } from '@/utils/diff-file'
import { singleFlight } from '@/utils/single-flight'
import type { DiffFile, FileTreeNode } from '@/api/types'
import { safeStorage } from '@/utils/safe-storage'

/** The remembered layout of the Changes file list: flat paths or a tree (#76). */
const DIFF_LIST_MODE_KEY = 'githuman.diffListMode'

/** How the Changes file list shows the files. */
export type DiffListMode = 'list' | 'tree'

function readDiffListMode(): DiffListMode {
  return safeStorage.get(DIFF_LIST_MODE_KEY) === 'tree' ? 'tree' : 'list'
}

/** A row of the diff tree. A file row carries its file, so the list needs no lookup. */
export type DiffTreeRow =
  | Extract<TreeRow, { kind: 'folder' }>
  | (Extract<TreeRow, { kind: 'file' }> & { file: DiffFile })

/** Paths of all folders in a tree. */
function folderPaths(nodes: readonly FileTreeNode[], into = new Set<string>()) {
  for (const node of nodes) {
    if (node.type !== 'directory') continue
    into.add(node.path)
    folderPaths(node.children ?? [], into)
  }
  return into
}

function hasRelevantChild(node: FileTreeNode): boolean {
  if (node.type === 'file') return node.isChanged
  return node.children?.some(hasRelevantChild) ?? false
}

/** Where the diff panel must scroll. `seq` makes a repeated click on the same file a new request. */
export interface ScrollRequest {
  path: string
  /** Index in `diffFiles`, not in the filtered list: the right panel ignores the filter. */
  index: number
  seq: number
}

export const useFileExplorerStore = defineStore('file-explorer', () => {
  const diffStore = useDiffStore()
  const {
    tree,
    initialLoading: treeInitialLoading,
    error: treeError,
    fetchTree,
    reset: resetTree
  } = useFileTree()
  const {
    lines: browseFileLines,
    isBinary: browseFileIsBinary,
    loading: browseFileLoading,
    error: browseFileError,
    fetchContent: fetchBrowseFileContent,
    reset: resetBrowseFileContent
  } = useFileContent()

  const source = ref<DiffSource>('unstaged')
  const browseMode = ref(false)
  const filter = ref<string | null>('')
  const selectedPath = ref<string | null>(null)
  const expandedFolders = ref<Set<string>>(new Set())
  const expandedFiles = ref<Set<string>>(new Set())
  const diffListMode = ref<DiffListMode>(readDiffListMode())
  // Folders of the diff tree that the user closed. Empty means that all are open.
  const collapsedDiffFolders = ref<Set<string>>(new Set())

  const scrollRequest = ref<ScrollRequest | null>(null)
  // The virtual list measures cards once. This counter tells the panel to measure again.
  const layoutVersion = ref(0)

  const sourceFiles = computed<DiffFile[]>(() =>
    source.value === 'staged' ? diffStore.stagedFiles : diffStore.unstagedFiles
  )

  const diffFileByPath = computed(
    () => new Map(sourceFiles.value.map(file => [pathOf(file), file]))
  )

  /** The tree of the source files. Only tree mode builds it: list mode does not sort twice. */
  const diffPathTree = computed<FileTreeNode[]>(() =>
    diffListMode.value === 'tree'
      ? buildTree(sourceFiles.value.map(pathOf), new Set())
      : []
  )

  /**
   * The files of the source in the order of the list. In tree mode the cards
   * follow the tree. Git sorts by full path, and the tree puts folders first,
   * so a click down the tree would make the cards jump up and down (#76).
   */
  const diffFiles = computed<DiffFile[]>(() => {
    const files = sourceFiles.value
    if (diffListMode.value === 'list') return files
    const byPath = diffFileByPath.value
    const ordered = flattenTree(diffPathTree.value, new Set(), true).flatMap(
      row => (row.kind === 'file' ? (byPath.get(row.path) ?? []) : [])
    )
    // A file must never drop out of the panel, even when the tree misses it.
    const placed = new Set(ordered)
    return [...ordered, ...files.filter(file => !placed.has(file))]
  })

  /** True while the filter has text: the tree then shows every folder open. */
  const filtering = computed(() => (filter.value ?? '').trim() !== '')

  const filteredDiffFiles = computed(() => {
    const query = (filter.value ?? '').trim().toLowerCase()
    if (!query) return diffFiles.value
    return diffFiles.value.filter(file =>
      pathOf(file).toLowerCase().includes(query)
    )
  })

  /**
   * Rows of the tree mode. A filter opens every folder, so no match hides.
   * A folder name is part of each path below it, so the filter keeps the
   * same files as `filteredDiffFiles`.
   */
  const diffTreeRows = computed<DiffTreeRow[]>(() => {
    const byPath = diffFileByPath.value
    const nodes = filterTree(diffPathTree.value, (filter.value ?? '').trim())
    return flattenTree(
      nodes,
      collapsedDiffFolders.value,
      filtering.value
    ).flatMap((row): DiffTreeRow[] => {
      if (row.kind === 'folder') return [row]
      const file = byPath.get(row.path)
      return file ? [{ ...row, file }] : []
    })
  })

  const filteredTree = computed(() =>
    filterTree(tree.value, filter.value ?? '')
  )

  const totalTreeFiles = computed(() => {
    let count = 0
    const walk = (nodes: FileTreeNode[]) => {
      for (const node of nodes) {
        if (node.type === 'file') {
          count++
        } else if (node.children) {
          walk(node.children)
        }
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

  watch(source, () => {
    selectedPath.value = null
    expandedFiles.value = new Set()
    // Staged and unstaged have different folders, so each starts open.
    collapsedDiffFolders.value = new Set()
    scrollRequest.value = null
    layoutVersion.value++
  })

  // A folder that left the diff and came back must not open closed.
  watch(diffPathTree, nodes => {
    if (diffListMode.value !== 'tree' || collapsedDiffFolders.value.size === 0)
      return
    const present = folderPaths(nodes)
    const kept = [...collapsedDiffFolders.value].filter(path =>
      present.has(path)
    )
    if (kept.length < collapsedDiffFolders.value.size) {
      collapsedDiffFolders.value = new Set(kept)
    }
  })

  watch(selectedPath, path => {
    if (!browseMode.value) return
    if (!path) {
      resetBrowseFileContent()
      return
    }
    void fetchBrowseFileContent(path, 'WORKTREE')
  })

  watch(diffListMode, mode => {
    safeStorage.set(DIFF_LIST_MODE_KEY, mode)
    // The cards change order, so the selected card moves: the panel follows it.
    if (selectedPath.value && !browseMode.value)
      scrollToFile(selectedPath.value)
  })

  /**
   * Opens or closes a folder row of the diff tree. The row can join several
   * folders, so all of them change together: a refetch that splits the chain
   * keeps the state.
   */
  function toggleDiffFolder(paths: readonly string[]) {
    const next = new Set(collapsedDiffFolders.value)
    const closed = paths.some(path => next.has(path))
    for (const path of paths) {
      if (closed) {
        next.delete(path)
      } else {
        next.add(path)
      }
    }
    collapsedDiffFolders.value = next
  }

  function toggleFolder(path: string) {
    const next = new Set(expandedFolders.value)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
    }
    expandedFolders.value = next
  }

  function toggleFileCard(path: string) {
    const next = new Set(expandedFiles.value)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
    }
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
    layoutVersion.value++
  }

  function collapseAllFiles() {
    expandedFiles.value = new Set()
    layoutVersion.value++
  }

  function selectFile(path: string) {
    selectedPath.value = path
    if (browseMode.value) return

    if (!expandedFiles.value.has(path)) {
      expandedFiles.value = new Set(expandedFiles.value).add(path)
    }
    scrollToFile(path)
  }

  function scrollToFile(path: string) {
    // The card may be unmounted. The panel scrolls by index, so the store holds no DOM.
    const index = diffFiles.value.findIndex(file => pathOf(file) === path)
    if (index < 0) return
    scrollRequest.value = {
      path,
      index,
      seq: (scrollRequest.value?.seq ?? 0) + 1
    }
  }

  // file-watcher.service.ts debounces this long before emitting `files:changed` after a git
  // mutation, so an explicit refresh() is reliably followed by a same-mutation SSE echo within
  // this window.
  const REFRESH_ECHO_WINDOW_MS = 400

  let refreshedAt = 0

  const refreshing = ref(false)

  /** A stage/unstage right after an external edit must not join a stale run (#37). */
  const doRefresh = singleFlight(async () => {
    refreshing.value = true
    try {
      await diffStore.fetchDiff()
      if (browseMode.value) {
        await fetchTree('WORKTREE', diffStore.changedPaths)
        if (selectedPath.value) {
          await fetchBrowseFileContent(selectedPath.value, 'WORKTREE')
        }
      }
    } finally {
      refreshing.value = false
    }
  })

  watch(browseMode, enabled => {
    filter.value = ''
    selectedPath.value = null
    // Through doRefresh: a fresh diff for the highlighting, and no tree fetch
    // racing one already running for an SSE event.
    if (enabled) {
      void doRefresh()
    } else {
      // Re-entering must not show last session's tree and error as current.
      resetTree()
      resetBrowseFileContent()
    }
  })

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
    diffListMode,
    collapsedDiffFolders,
    scrollRequest,
    layoutVersion,
    tree,
    treeInitialLoading,
    treeError,
    refreshing,
    browseFileLines,
    browseFileIsBinary,
    browseFileLoading,
    browseFileError,
    diffFiles,
    filtering,
    filteredDiffFiles,
    diffTreeRows,
    filteredTree,
    totalTreeFiles,
    toggleFolder,
    toggleDiffFolder,
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
