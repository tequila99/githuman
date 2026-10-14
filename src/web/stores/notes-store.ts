import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { notesApi } from '@/api/notes'
import { ApiRequestError } from '@/api/client'
import { errorMessage } from '@/utils/error-message'
import { reconcileNoteEntries } from '@/utils/notes/reconcile-entries'
import { singleFlight } from '@/utils/single-flight'
import { noteMetadata } from '../../shared/notes/document.ts'
import type {
  Note,
  NotesIndex,
  NoteDescriptor
} from '../../shared/notes/types.ts'

export interface NoteDraft {
  id?: string
  storageId?: string
  path: string
  text: string
  saved: string
  version: string
  status: 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'
  error: string
  disk: Note | null
  revision: number
}

function readDraft(draft: NoteDraft) {
  return draft.id && draft.storageId
    ? notesApi.readId(draft.id, draft.storageId)
    : notesApi.read(draft.path)
}

export const useNotesStore = defineStore('notes', () => {
  const index = ref<NotesIndex>({ entries: [], storage: '', warning: null })
  const selectedId = ref('')
  const createdId = ref('')
  const descriptor = ref<NoteDescriptor | null>(null)
  const drafts = reactive<Record<string, NoteDraft>>({})
  const error = ref('')
  const loading = ref(false)
  const current = computed(() => drafts[selectedId.value])
  const selected = computed(
    () => current.value?.path ?? descriptor.value?.note.path ?? ''
  )
  const pending = new Map<string, Promise<boolean>>()
  let selection = 0

  function install(note: Note) {
    const id = note.id ?? note.path
    const previous = drafts[id]
    drafts[id] = {
      ...note,
      saved: note.text,
      status: 'saved',
      error: '',
      disk: null,
      revision: (previous?.revision ?? 0) + 1
    }
  }
  function draftKey(path: string) {
    return drafts[path]
      ? path
      : (Object.keys(drafts).find(id => drafts[id]?.path === path) ?? path)
  }
  function edit(path: string, text: string) {
    const draft = drafts[draftKey(path)]
    if (!draft || draft.text === text) return
    draft.text = text
    if (draft.status !== 'conflict') {
      draft.status = text === draft.saved ? 'saved' : 'dirty'
      draft.error = ''
    }
  }
  async function write(path: string): Promise<boolean> {
    const draft = drafts[path]
    if (!draft) return true
    while (draft.text !== draft.saved) {
      if (draft.status === 'conflict') return false
      const metadata = noteMetadata(draft.text)
      if (metadata.error) {
        draft.status = 'error'
        draft.error = metadata.error
        return false
      }
      const text = draft.text
      draft.status = 'saving'
      try {
        const saved = await notesApi.save(
          draft.path,
          text,
          draft.version,
          draft.id,
          draft.storageId
        )
        draft.path = saved.path
        draft.saved = saved.text
        draft.version = saved.version
        draft.error = ''
      } catch (err) {
        draft.status =
          err instanceof ApiRequestError && err.status === 409
            ? 'conflict'
            : 'error'
        draft.error = errorMessage(err)
        if (draft.status === 'conflict') {
          draft.disk = await readDraft(draft).catch(() => null)
        }
        return false
      }
    }
    draft.status = 'saved'
    return true
  }
  async function save(path = selectedId.value): Promise<boolean> {
    path = draftKey(path)
    const existing = pending.get(path)
    if (existing) {
      const ok = await existing
      return ok ? save(path) : false
    }
    const promise = write(path)
    pending.set(path, promise)
    try {
      return await promise
    } finally {
      pending.delete(path)
    }
  }
  const refresh = singleFlight(async () => {
    try {
      const next = await notesApi.index()
      const entries = reconcileNoteEntries(index.value.entries, next.entries)
      if (
        entries !== index.value.entries ||
        next.storage !== index.value.storage ||
        next.warning !== index.value.warning ||
        next.storageId !== index.value.storageId ||
        next.revision !== index.value.revision ||
        JSON.stringify(next.issues) !== JSON.stringify(index.value.issues)
      ) {
        index.value = { ...next, entries }
      }
      const path = selectedId.value
      if (pending.has(path)) await pending.get(path)
      const draft = drafts[path]
      if (draft) {
        try {
          const requestedVersion = draft.version
          const disk = await readDraft(draft)
          if (
            selectedId.value !== path ||
            drafts[path] !== draft ||
            draft.version !== requestedVersion
          ) {
            return
          }
          draft.path = disk.path
          if (disk.id && disk.id !== draft.id && draft.text === draft.saved) {
            install(disk)
            selectedId.value = disk.id
            delete drafts[path]
            return
          }
          if (disk.version !== draft.version) {
            if (draft.text === draft.saved) {
              install(disk)
            } else {
              draft.status = 'conflict'
              draft.disk = disk
              draft.error = 'The note changed on disk.'
            }
          }
        } catch (err) {
          draft.status =
            err instanceof ApiRequestError && err.status === 404
              ? 'conflict'
              : 'error'
          draft.disk = null
          draft.error = errorMessage(err)
        }
      }
      if (descriptor.value && index.value.storageId) {
        descriptor.value = await notesApi.descriptor(
          descriptor.value.note.id,
          index.value.storageId
        )
      }
      error.value = ''
    } catch (err) {
      error.value = errorMessage(err)
    }
  })
  async function select(path: string): Promise<boolean> {
    const request = ++selection
    if (!(await save())) return false
    loading.value = true
    try {
      const note = await notesApi.read(path)
      if (request !== selection) return false
      install(note)
      selectedId.value = note.id ?? note.path
      descriptor.value = null
      error.value = ''
      return true
    } catch (err) {
      error.value = errorMessage(err)
      return false
    } finally {
      if (request === selection) loading.value = false
    }
  }
  async function create(path: string, text = '') {
    if (!(await save())) return false
    try {
      const note = await notesApi.create(path, text)
      install(note)
      createdId.value = note.id ?? note.path
      await refresh()
      return true
    } catch (err) {
      error.value = errorMessage(err)
      return false
    }
  }
  async function rename(
    path: string,
    name: string,
    isFolder: boolean,
    destination?: string
  ): Promise<boolean> {
    const affected = (value: string) =>
      value === path || (isFolder && value.startsWith(path + '/'))
    for (const key of Object.keys(drafts)) {
      if (!(await save(key))) {
        error.value = drafts[key]?.error || 'Save the note before renaming.'
        return false
      }
    }
    try {
      await refresh()
      const noteId = index.value.entries.find(
        entry => entry.path === path && !entry.folder
      )?.id
      await notesApi.rename(
        path,
        name,
        isFolder,
        destination,
        noteId,
        index.value.revision
      )
      const target =
        destination ?? [...path.split('/').slice(0, -1), name].join('/')
      const remap = (value: string) => target + value.slice(path.length)
      for (const key of Object.keys(drafts)) {
        if (!affected(drafts[key]!.path)) continue
        const draft = drafts[key]!
        const oldPath = draft.path
        draft.path = remap(oldPath)
        if (!draft.id) {
          delete drafts[key]
          drafts[draft.path] = draft
          if (selectedId.value === key) selectedId.value = draft.path
        }
      }

      await refresh()
      return true
    } catch (err) {
      error.value = errorMessage(err)
      return false
    }
  }
  async function folder(path: string) {
    try {
      await notesApi.folder(path)
      await refresh()
    } catch (err) {
      error.value = errorMessage(err)
    }
  }
  async function reloadDisk() {
    const path = selectedId.value
    await pending.get(path)
    try {
      const draft = drafts[path]
      if (!draft) return false
      install(await readDraft(draft))
      return true
    } catch (err) {
      error.value = errorMessage(err)
      return false
    }
  }
  async function saveCopy(path: string) {
    const draft = current.value
    if (!draft) return false
    try {
      const note = await notesApi.create(path, draft.text)
      install(note)
      createdId.value = note.id ?? note.path
      delete drafts[draft.id ?? draft.path]
      await refresh()
      return true
    } catch (err) {
      error.value = errorMessage(err)
      return false
    }
  }
  async function selectId(id: string, storageId: string): Promise<boolean> {
    const request = ++selection
    if (!(await save())) return false
    loading.value = true
    try {
      const info = await notesApi.descriptor(id, storageId)
      const note =
        info.note.presence === 'present'
          ? await notesApi.readId(info.note.id, storageId)
          : null
      if (request !== selection) return false
      descriptor.value = info
      selectedId.value = info.note.id
      if (note) install(note)
      error.value = ''
      return true
    } catch (err) {
      if (request === selection) {
        selectedId.value = ''
        descriptor.value = null
        error.value = errorMessage(err)
      }
      return false
    } finally {
      if (request === selection) loading.value = false
    }
  }
  function clearSelection() {
    selectedId.value = ''
    descriptor.value = null
  }
  async function resolveIdentity(
    issueId: string,
    restore: boolean,
    candidateId?: string
  ) {
    if (!(await save())) return false
    try {
      await notesApi.resolveIdentity(issueId, restore, candidateId)
      await refresh()
      return true
    } catch (err) {
      error.value = errorMessage(err)
      return false
    }
  }
  async function repair() {
    if (!(await save())) return
    try {
      await notesApi.repair()
      await refresh()
    } catch (err) {
      error.value = errorMessage(err)
    }
  }
  return {
    createdId,
    selectedId,
    descriptor,
    selectId,
    clearSelection,
    resolveIdentity,
    repair,
    index,
    selected,
    drafts,
    current,
    error,
    loading,
    edit,
    save,
    refresh,
    select,
    create,
    folder,
    reloadDisk,
    saveCopy,
    rename
  }
})
