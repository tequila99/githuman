import { apiGet, apiPatch, apiPost, apiPostForm } from './client'
import { MAX_NOTE_ASSET_BYTES } from '../../shared/notes/constants.ts'
import type {
  Note,
  NoteAsset,
  NotesIndex,
  NoteDescriptor,
  NoteMutation,
  NoteResolution,
  NoteRecord
} from '../../shared/notes/types.ts'
export const notesApi = {
  uploadAsset: async (file: File) => {
    if (file.size > MAX_NOTE_ASSET_BYTES) {
      throw new Error('Image must be under 10 MB')
    }
    const body = new FormData()
    body.append('file', file)
    return apiPostForm<NoteAsset>('/api/notes/assets', body)
  },
  resolvePath: (path: string) =>
    apiGet<NoteRecord>('/api/notes/path?path=' + encodeURIComponent(path)),
  index: () => apiGet<NotesIndex>('/api/notes'),
  read: (path: string) =>
    apiGet<Note>('/api/notes/document?path=' + encodeURIComponent(path)),
  create: (path: string, text: string) =>
    apiPost<Note>('/api/notes/document', { path, text }),
  save: (
    path: string,
    text: string,
    version: string,
    id?: string,
    storageId?: string
  ) =>
    apiPatch<Note>('/api/notes/document', {
      path,
      text,
      version,
      id,
      storageId
    }),
  readId: (id: string, storageId: string) =>
    apiGet<Note>(
      '/api/notes/by-id?id=' +
        encodeURIComponent(id) +
        '&storageId=' +
        encodeURIComponent(storageId)
    ),
  descriptor: (id: string, storageId: string) =>
    apiGet<NoteDescriptor>(
      '/api/notes/identity?id=' +
        encodeURIComponent(id) +
        '&storageId=' +
        encodeURIComponent(storageId)
    ),
  resolve: (
    sourceId: string,
    storageId: string,
    text: string,
    href: string,
    occurrence?: number
  ) =>
    apiPost<NoteResolution>('/api/notes/resolve', {
      sourceId,
      storageId,
      text,
      href,
      occurrence
    }),
  resolveIdentity: (issueId: string, restore: boolean, candidateId?: string) =>
    apiPost<void>('/api/notes/identity/resolve', {
      issueId,
      restore,
      candidateId
    }),
  repair: () => apiPost<void>('/api/notes/repair', {}),
  rename: (
    path: string,
    name: string,
    folder: boolean,
    target?: string,
    id?: string,
    revision?: string
  ) =>
    apiPost<NoteMutation>('/api/notes/rename', {
      path,
      name,
      folder,
      target,
      id,
      revision
    }),
  folder: (path: string) => apiPost<void>('/api/notes/folder', { path })
}
