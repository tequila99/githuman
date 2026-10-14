import {
  computed,
  nextTick,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter
} from 'vue'
import {
  useRoute,
  useRouter,
  onBeforeRouteUpdate,
  onBeforeRouteLeave
} from 'vue-router'
import { headingSlug } from '../../../shared/utils/heading-slug.ts'
import {
  useNotesHistoryState,
  type NoteViewState
} from './use-notes-history-state'
import { notesApi } from '@/api/notes'
import type { useNotesStore } from '@/stores/notes-store'
import { errorMessage } from '@/utils/error-message'

export function useNotesRouting(
  store: ReturnType<typeof useNotesStore>,
  options: {
    flush: () => Promise<boolean>
    panel: MaybeRefOrGetter<HTMLElement | null>
  }
) {
  const route = useRoute()
  const router = useRouter()
  const activeFolder = computed(() =>
    route.name === 'note-document'
      ? null
      : typeof route.query.folder === 'string'
        ? route.query.folder
        : null
  )
  const creationFolder = computed(
    () => activeFolder.value ?? store.selected.split('/').slice(0, -1).join('/')
  )
  const paths = computed(() =>
    store.index.entries.filter(entry => !entry.folder).map(entry => entry.path)
  )
  const tags = computed(() =>
    [...new Set(store.index.entries.flatMap(entry => entry.tags))].sort()
  )
  const { views, position, currentPosition } = useNotesHistoryState()
  const viewState = shallowRef<NoteViewState | null>(null)
  let restoreCurrent: (() => void) | undefined
  let request = 0
  function capture() {
    const pos = currentPosition.value
    const panel = toValue(options.panel)
    if (pos === null || !panel) return
    views.set(pos, {
      scroll: panel.querySelector('.note-body')?.scrollTop ?? 0,
      sourceScroll: panel.querySelector('textarea')?.scrollTop ?? 0,
      mode:
        panel
          .querySelector('[data-note-mode]')
          ?.getAttribute('data-note-mode') ?? 'visual'
    })
  }
  async function guard() {
    const saved = await options.flush()
    if (saved) capture()
    return saved
  }
  onBeforeRouteUpdate(guard)
  onBeforeRouteLeave(guard)
  async function open(id: string, anchor = '', replace = false) {
    const storageId = store.index.storageId
    if (!storageId) return
    await router[replace ? 'replace' : 'push']({
      name: 'note-document',
      params: { storageId, id },
      hash: anchor ? '#' + encodeURIComponent(anchor) : ''
    })
  }
  async function select(path: string) {
    if (!store.index.storageId) await store.refresh()
    const entry = store.index.entries.find(
      note => note.path === path && !note.folder
    )
    if (entry?.id) {
      await open(entry.id)
    } else {
      store.error = 'The note is not registered in this storage.'
    }
  }
  async function selectFolder(path: string) {
    await router.push({ name: 'notes', query: { folder: path } })
  }
  async function showNote() {
    const id = store.createdId || store.selectedId
    if (id) await open(id)
    store.createdId = ''
  }
  async function follow(href: string, occurrence?: number) {
    if (!store.current?.id || !store.index.storageId) return
    try {
      const target = await notesApi.resolve(
        store.current.id,
        store.index.storageId,
        store.current.text,
        href,
        occurrence
      )
      await open(target.id, target.anchor)
    } catch (error) {
      store.error = errorMessage(error)
    }
  }
  async function applyRoute() {
    const seq = ++request
    if (!store.index.storageId) await store.refresh()
    if (seq !== request) return
    if (route.name !== 'note-document') {
      if (typeof route.query.file === 'string') {
        try {
          const target = await notesApi.resolvePath(route.query.file)
          if (seq === request) await open(target.id, '', true)
        } catch (error) {
          store.clearSelection()
          store.error = errorMessage(error)
        }
      } else if (activeFolder.value === null) {
        store.clearSelection()
      }
      return
    }
    const id = String(route.params.id)
    const storageId = String(route.params.storageId)
    if (storageId !== store.index.storageId) {
      store.clearSelection()
      store.error = 'This link belongs to a different notes storage.'
      return
    }
    const ok = await store.selectId(id, storageId)
    if (!ok || seq !== request) return
    if (store.selectedId !== id) {
      await open(
        store.selectedId,
        decodeURIComponent(route.hash.slice(1)),
        true
      )
      return
    }
    await nextTick()
    const state = views.get(position() ?? -1)
    viewState.value = state ?? null
    const panel = toValue(options.panel)
    const restore = () => {
      if (!panel || seq !== request) return
      const body = panel.querySelector('.note-body')
      const source = panel.querySelector('textarea')
      if (state) {
        if (body) body.scrollTop = state.scroll
        if (source) source.scrollTop = state.sourceScroll
      } else if (route.hash) {
        const anchor = decodeURIComponent(route.hash.slice(1))
        const counts = new Map<string, number>()
        for (const heading of panel.querySelectorAll(
          '.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6'
        )) {
          const slug = headingSlug(heading.textContent ?? '')
          const count = counts.get(slug) ?? 0
          counts.set(slug, count + 1)
          heading.id = count ? slug + '-' + count : slug
        }
        const element = [...panel.querySelectorAll('[id]')].find(
          item => item.id === anchor
        )
        if (element) element.scrollIntoView({ block: 'start' })
      } else if (body) {
        body.scrollTop = 0
      }
    }
    restoreCurrent = restore
    restore()
  }
  watch(
    () => route.fullPath,
    () => {
      void applyRoute()
    },
    { immediate: true }
  )
  watch(
    () => [store.selectedId, store.descriptor?.note.id] as const,
    ([id, canonicalId]) => {
      if (
        id &&
        route.name === 'note-document' &&
        route.params.id !== id &&
        String(route.params.storageId) === store.index.storageId &&
        canonicalId === id
      ) {
        void open(id, decodeURIComponent(route.hash.slice(1)), true)
      }
    }
  )
  return {
    activeFolder,
    creationFolder,
    paths,
    tags,
    select,
    selectFolder,
    showNote,
    follow,
    viewState,
    restoreView: () => {
      void nextTick().then(() => restoreCurrent?.())
    }
  }
}
