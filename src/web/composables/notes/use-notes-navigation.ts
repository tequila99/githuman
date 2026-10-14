import {
  computed,
  nextTick,
  shallowRef,
  toValue,
  type MaybeRefOrGetter
} from 'vue'
import type { useNotesStore } from '@/stores/notes-store'
import { resolveNoteLink } from '../../../shared/notes/links.ts'
import { errorMessage } from '@/utils/error-message'

type NavigationStore = Pick<
  ReturnType<typeof useNotesStore>,
  'selected' | 'select' | 'index' | 'error'
>

export function useNotesNavigation(
  store: NavigationStore,
  options: {
    flush: () => Promise<boolean>
    panel: MaybeRefOrGetter<HTMLElement | null>
  }
) {
  const activeFolder = shallowRef<string | null>(null)
  let navigation = 0
  const creationFolder = computed(
    () => activeFolder.value ?? store.selected.split('/').slice(0, -1).join('/')
  )
  const paths = computed(() =>
    store.index.entries.filter(entry => !entry.folder).map(entry => entry.path)
  )
  const tags = computed(() =>
    [...new Set(store.index.entries.flatMap(entry => entry.tags))].sort()
  )
  async function select(path: string) {
    const request = ++navigation
    if (await store.select(path)) {
      if (request === navigation) activeFolder.value = null
    }
  }
  async function selectFolder(path: string) {
    const request = ++navigation
    if (!(await options.flush()) || request !== navigation) return
    activeFolder.value = path
  }
  function showNote() {
    activeFolder.value = null
  }
  async function follow(href: string) {
    try {
      const target = resolveNoteLink(store.selected, href)
      if (!target) return
      if (target.path !== store.selected) await select(target.path)
      if (store.selected !== target.path) return
      await nextTick()
      if (target.anchor) {
        const heading = [
          ...(toValue(options.panel)?.querySelectorAll('[id]') ?? [])
        ].find(element => element.id === target.anchor)
        heading?.scrollIntoView({ block: 'start' })
      }
    } catch (error) {
      store.error = errorMessage(error)
    }
  }
  return {
    activeFolder,
    creationFolder,
    paths,
    tags,
    select,
    selectFolder,
    showNote,
    follow
  }
}
