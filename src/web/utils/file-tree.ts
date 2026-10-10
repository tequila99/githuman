import type { FileTreeNode } from '@/api/types'

/** Left padding of a top-level tree row, in px. */
const TREE_INDENT_BASE_PX = 8
/** Extra left padding for each tree level, in px. */
const TREE_INDENT_STEP_PX = 12
/** A file row starts past the chevron of a folder row, in px. */
const TREE_FILE_OFFSET_PX = 20

/** Left padding of a tree row, so files and folders of both trees line up. */
export function treeIndentPx(depth: number, file: boolean): number {
  return (
    TREE_INDENT_BASE_PX +
    depth * TREE_INDENT_STEP_PX +
    (file ? TREE_FILE_OFFSET_PX : 0)
  )
}

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

/**
 * Builds a nested tree from a flat list of file paths, directories first, then
 * alphabetically. A file and a folder can have the same path in a diff (a
 * deleted folder `foo/` and a new file `foo`), so a node is found by name and
 * type. Each level keeps a Map, so a large folder costs no repeated search.
 */
export function buildTree(
  files: readonly string[],
  changedFiles: ReadonlySet<string>
): FileTreeNode[] {
  const root: FileTreeNode[] = []
  const lookups = new Map<FileTreeNode[], Map<string, FileTreeNode>>()
  const lookupOf = (level: FileTreeNode[]) => {
    let lookup = lookups.get(level)
    if (!lookup) {
      lookup = new Map()
      lookups.set(level, lookup)
    }
    return lookup
  }

  for (const filePath of files) {
    const parts = filePath.split('/')
    let currentLevel = root
    let currentPath = ''

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!part) continue

      const isFile = i === parts.length - 1
      currentPath = currentPath === '' ? part : `${currentPath}/${part}`
      const key = `${isFile ? 'f' : 'd'}:${part}`
      const lookup = lookupOf(currentLevel)
      let node = lookup.get(key)

      if (!node) {
        node = {
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
          isChanged: isFile ? changedFiles.has(filePath) : false,
          children: isFile ? undefined : []
        }
        currentLevel.push(node)
        lookup.set(key, node)
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

/** One row of a flattened tree in a virtual list. */
export type TreeRow =
  | {
      kind: 'folder'
      /** The deepest folder of a compressed folder: its key in the list. */
      path: string
      /** Every folder that the row joins, from the top: `a`, `a/b`, `a/b/c`. */
      paths: string[]
      /** The joined names, `a/b/c`. */
      name: string
      depth: number
      expanded: boolean
    }
  | { kind: 'file'; path: string; name: string; depth: number }

/**
 * Turns a tree into the rows of a virtual list. A folder that holds only one
 * folder joins it in one row, as on GitHub (compressed folder). A refetch can
 * split or extend such a chain, so a row is collapsed when any folder of its
 * chain is in `collapsed`. With `ignoreCollapsed`, every folder is open: a
 * filter must show all its matches.
 */
export function flattenTree(
  nodes: readonly FileTreeNode[],
  collapsed: ReadonlySet<string>,
  ignoreCollapsed: boolean
): TreeRow[] {
  const rows: TreeRow[] = []
  const visit = (items: readonly FileTreeNode[], depth: number) => {
    for (const item of items) {
      if (item.type === 'file') {
        rows.push({ kind: 'file', path: item.path, name: item.name, depth })
        continue
      }
      let folder = item
      const paths = [folder.path]
      const names = [folder.name]
      while (
        folder.children?.length === 1 &&
        folder.children[0]?.type === 'directory'
      ) {
        folder = folder.children[0]
        paths.push(folder.path)
        names.push(folder.name)
      }
      const expanded =
        ignoreCollapsed || !paths.some(path => collapsed.has(path))
      rows.push({
        kind: 'folder',
        path: folder.path,
        paths,
        name: names.join('/'),
        depth,
        expanded
      })
      if (expanded) visit(folder.children ?? [], depth + 1)
    }
  }
  visit(nodes, 0)
  return rows
}
