import { computed, shallowRef, toValue, type MaybeRefOrGetter } from 'vue'
import { compareNoteItems, matchesNoteTags } from '@/utils/note-navigation'
import type { NoteTagFilter } from '@/types/notes'
import type { NoteEntry } from '../../../shared/notes/types.ts'

interface TreeNode {
  id: string
  label: string
  folder: boolean
  handler?: () => void
  children: TreeNode[]
}
function sort(children: TreeNode[]) {
  children.sort(compareNoteItems)
  for (const child of children) sort(child.children)
}

export function useNotesTree(entries: MaybeRefOrGetter<NoteEntry[]>) {
  const query = shallowRef('')
  const filter = shallowRef<NoteTagFilter>({ tags: [], mode: 'all' })
  const expanded = shallowRef<string[]>([])
  const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase())
  const filtering = computed(
    () => Boolean(normalizedQuery.value) || Boolean(filter.value.tags.length)
  )
  const nodes = computed(() => {
    const roots: TreeNode[] = [],
      byPath = new Map<string, TreeNode>()
    const filtered = toValue(entries).filter(entry =>
      entry.folder
        ? !filtering.value
        : entry.path.toLocaleLowerCase().includes(normalizedQuery.value) &&
          matchesNoteTags(entry.tags, filter.value.tags, filter.value.mode)
    )
    for (const entry of filtered) {
      const parts = entry.path.split('/')
      let children = roots
      for (let i = 0; i < parts.length; i++) {
        const id = parts.slice(0, i + 1).join('/')
        let node = byPath.get(id)
        if (!node) {
          const folder = i < parts.length - 1 || entry.folder
          node = {
            id,
            label: folder ? parts[i]! : parts[i]!.replace(/\.md$/i, ''),
            folder,
            children: []
          }
          if (folder) node.handler = () => toggleFolder(id)
          byPath.set(id, node)
          children.push(node)
        }
        children = node.children
      }
    }
    sort(roots)
    return roots
  })
  function toggleFolder(path: string) {
    if (filtering.value) return
    expanded.value = expanded.value.includes(path)
      ? expanded.value.filter(value => value !== path)
      : [...expanded.value, path]
  }
  const resultFolders = computed(() => {
    const paths: string[] = []
    const visit = (items: TreeNode[]) => {
      for (const node of items) {
        if (node.folder) {
          paths.push(node.id)
          visit(node.children)
        }
      }
    }
    visit(nodes.value)
    return paths
  })
  const visibleExpanded = computed({
    get: () => (filtering.value ? resultFolders.value : expanded.value),
    set: (paths: string[]) => {
      // Search results stay open without replacing the user's expansion state.
      if (!filtering.value) expanded.value = paths
    }
  })
  const entryByPath = computed(
    () => new Map(toValue(entries).map(entry => [entry.path, entry]))
  )
  function reveal(path: string) {
    if (filtering.value) return
    const parts = path.split('/')
    const parents = parts
      .slice(0, -1)
      .map((_, i) => parts.slice(0, i + 1).join('/'))
    expanded.value = [...new Set([...expanded.value, ...parents])]
  }
  return {
    query,
    filter,
    nodes,
    filtering,
    visibleExpanded,
    entryByPath,
    reveal
  }
}
