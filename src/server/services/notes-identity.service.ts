import PQueue from 'p-queue'
import {
  noteBasename,
  noteChildPath,
  noteParentPath
} from '../../shared/notes/note-path.ts'
import { lstat } from 'node:fs/promises'
import { isSystemError } from '../utils/system-error.ts'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { NotesRepository } from '../repositories/notes.repo.ts'
import {
  NotesCatalogRepository,
  type CatalogNote
} from '../repositories/notes-catalog.repo.ts'
import { NotesOperationsService } from './notes-operations.service.ts'
import { NotesWriter } from './notes-writer.service.ts'
import { noteIdentity, withNoteIdentity } from '../../shared/notes/identity.ts'
import { noteMetadata } from '../../shared/notes/document.ts'
import {
  noteReferences,
  referenceTarget,
  sameReference,
  type NoteReference
} from '../../shared/notes/references.ts'
import type {
  Note,
  NotesIndex,
  NoteMutation
} from '../../shared/notes/types.ts'
import { BadRequestError, NotFoundError } from '../errors/http.ts'
import { NoteConflictError, NoteExistsError } from '../errors/notes.ts'
import { sha256Hex } from '../utils/hash.ts'
import { safeDecodeURIComponent } from '../../shared/utils/safe-decode.ts'

// A second complete scan confirms absence, instead of treating an atomic save as deletion.
const ABSENCE_GRACE_MS = 2500
// Longest file name that common file systems accept, in bytes.
const MAX_FILENAME_BYTES = 255

function newRecord(id: string, path: string, version: string): CatalogNote {
  const now = new Date().toISOString()
  return {
    id,
    path,
    version,
    presence: 'present',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    redirectId: null
  }
}
function portablePath(path: string) {
  for (const part of path.split('/')) {
    if (
      /[<>:"\\|?*]/.test(part) ||
      part.split('').some(char => char.charCodeAt(0) < 32) ||
      /[. ]$/.test(part) ||
      /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)
    ) {
      throw new BadRequestError(
        'The destination name is not portable to Windows.'
      )
    }
  }
}

/**
 * Path a deleted note moves to. The suffix frees the original name for a new
 * note. The stem is cut by bytes so the name fits the file system limit.
 */
function deletedNotePath(path: string, uuid: string): string {
  const suffix = `_deleted_${uuid}.md`
  const stem = noteBasename(path).replace(/\.md$/i, '')
  const room = MAX_FILENAME_BYTES - Buffer.byteLength(suffix)
  let cut = stem
  while (Buffer.byteLength(cut) > room) {
    cut = cut.slice(0, -1)
  }
  return noteChildPath(noteParentPath(path), cut + suffix)
}

export class NotesIdentityService {
  readonly catalog: NotesCatalogRepository
  readonly writer: NotesWriter
  readonly operations: NotesOperationsService
  // One action at a time: catalog and file changes must not interleave.
  private readonly queue = new PQueue({ concurrency: 1 })
  private readonly cache = new Map<
    string,
    {
      signature: string
      note: Pick<Note, 'version'>
      identity: ReturnType<typeof noteIdentity>
      metadata: ReturnType<typeof noteMetadata>
    }
  >()
  private readonly absentSince = new Map<string, number>()
  // Signature of each file that failed to read, so a poll does not read it again.
  private readonly unreadable = new Map<string, string>()
  private closed = false
  readonly files: NotesRepository
  constructor(files: NotesRepository, db: DatabaseSync) {
    this.files = files
    this.catalog = new NotesCatalogRepository(db, files.root)
    this.writer = new NotesWriter(files.root)
    this.operations = new NotesOperationsService({
      files,
      catalog: this.catalog,
      writer: this.writer,
      record: id => this.record(id),
      changed: (id, note) => {
        this.catalog.put({
          ...this.record(id),
          version: note.version,
          updatedAt: new Date().toISOString()
        })
        this.indexLinks(id, note.text)
        this.cache.set(note.path, {
          signature: '',
          note: { version: note.version },
          identity: noteIdentity(note.text),
          metadata: noteMetadata(note.text)
        })
      }
    })
  }
  run<T>(action: () => Promise<T>): Promise<T> {
    return this.queue.add(async () => {
      if (this.closed) throw new BadRequestError('Notes storage is closing.')
      return action()
    })
  }
  async close() {
    this.closed = true
    await this.queue.onIdle()
    await this.writer.close()
  }
  private record(id: string): CatalogNote {
    let note = this.catalog.get(id)
    const seen = new Set<string>()
    while (note?.redirectId && !seen.has(note.id)) {
      seen.add(note.id)
      note = this.catalog.get(note.redirectId)
    }
    if (!note) throw new NotFoundError('Unknown note identity.')
    return note
  }
  private issue(
    id: string,
    message: string,
    noteId: string | null,
    candidateId: string | null = null,
    kind: 'identity' | 'rewrite' | 'metadata' = 'identity'
  ) {
    this.catalog.issue({ id, message, noteId, candidateId, kind })
  }
  private async synchronize() {
    await this.files.path('probe.md')
    try {
      await lstat(this.files.root)
    } catch (error) {
      if (isSystemError(error, 'ENOENT') && !this.catalog.all().length) {
        return []
      }
      throw new BadRequestError(
        'Notes storage is unavailable. Existing identities are retained.'
      )
    }
    await this.writer.acquire()
    if (this.catalog.operations().length) await this.operations.recover()
    const entries = await this.files.list()
    const documents: {
      path: string
      note: Pick<Note, 'version'>
      yamlId: string | null
      identityWarning: string | null
      references?: NoteReference[]
    }[] = []
    // Read the whole snapshot successfully before changing any presence records.
    for (const entry of entries) {
      if (entry.folder) continue
      let references: NoteReference[] | undefined
      let cached = this.cache.get(entry.path)
      if (!cached || cached.signature !== entry.signature) {
        if (this.unreadable.get(entry.path) === entry.signature) continue
        let note: Note
        try {
          note = await this.files.read(entry.path)
        } catch (error) {
          // One bad file must not stop the synchronization of other notes.
          if (!(error instanceof BadRequestError)) throw error
          this.unreadable.set(entry.path, entry.signature)
          this.issue(
            'unreadable:' + entry.path,
            'Skipped ' + entry.path + ': ' + error.message,
            null,
            null,
            'metadata'
          )
          continue
        }
        this.unreadable.delete(entry.path)
        this.catalog.dismiss('unreadable:' + entry.path)
        cached = {
          signature: entry.signature,
          note: { version: note.version },
          identity: noteIdentity(note.text),
          metadata: noteMetadata(note.text)
        }
        references = noteReferences(note.text)
        this.cache.set(entry.path, cached)
      }
      documents.push({
        path: entry.path,
        note: cached.note,
        yamlId: cached.identity.id,
        identityWarning: cached.identity.warning,
        ...(references ? { references } : {})
      })
    }
    const entryPaths = new Set(entries.map(entry => entry.path))
    for (const path of this.unreadable.keys()) {
      if (entryPaths.has(path)) continue
      this.unreadable.delete(path)
      this.catalog.dismiss('unreadable:' + path)
    }
    const records = this.catalog.all()
    const byId = new Map(records.map(record => [record.id, record]))
    const presentByPath = new Map(
      records
        .filter(
          record =>
            (record.presence === 'present' || record.deletedAt) &&
            !record.redirectId
        )
        .map(record => [record.path, record])
    )
    const livePaths = new Set(documents.map(doc => doc.path))
    const counts = new Map<string, number>()
    for (const doc of documents) {
      if (doc.yamlId) counts.set(doc.yamlId, (counts.get(doc.yamlId) ?? 0) + 1)
    }
    const changes: { id: string; from: string; to: string }[] = []
    const changed = new Set<string>()
    this.catalog.transaction(() => {
      // Release paths first, so swaps and folder moves do not violate uniqueness.
      for (const record of records) {
        if (record.presence !== 'present' || livePaths.has(record.path)) {
          continue
        }
        if (
          documents.some(
            doc => doc.yamlId === record.id && counts.get(record.id) === 1
          )
        ) {
          this.catalog.put({ ...record, presence: 'missing' })
          continue
        }
        const since = this.absentSince.get(record.id)
        if (since === undefined) {
          this.catalog.reopen('missing:' + record.id)
          this.absentSince.set(record.id, Date.now())
        } else if (Date.now() - since >= ABSENCE_GRACE_MS) {
          this.catalog.put({ ...record, presence: 'missing' })
        }
      }
      for (const doc of documents) {
        const byPath = presentByPath.get(doc.path)
        const hinted =
          doc.yamlId && counts.get(doc.yamlId) === 1
            ? byId.get(doc.yamlId)
            : undefined
        let record = byPath
        if (hinted && hinted !== byPath && !livePaths.has(hinted.path)) {
          if (byPath) this.catalog.put({ ...byPath, presence: 'missing' })
          record = hinted
        } else if (!record && hinted && hinted.path === doc.path) {
          record = hinted
        }
        if (!record) {
          const id =
            doc.yamlId &&
            counts.get(doc.yamlId) === 1 &&
            !this.catalog.get(doc.yamlId)
              ? doc.yamlId
              : randomUUID()
          record = newRecord(id, doc.path, doc.note.version)
          this.catalog.put(record)
          changed.add(record.id)
        }
        if (record.path !== doc.path) {
          changes.push({ id: record.id, from: record.path, to: doc.path })
        }
        if (record.version !== doc.note.version) changed.add(record.id)
        if (
          record.path !== doc.path ||
          record.presence !== 'present' ||
          record.version !== doc.note.version
        ) {
          this.catalog.put({
            ...record,
            path: doc.path,
            presence: 'present',
            version: doc.note.version,
            updatedAt:
              record.version === doc.note.version
                ? record.updatedAt
                : new Date().toISOString()
          })
        }
        this.absentSince.delete(record.id)
        this.catalog.dismiss('missing:' + record.id)
        const identity = { id: doc.yamlId, warning: doc.identityWarning }
        const warning =
          identity.warning ??
          (identity.id && identity.id !== record.id
            ? 'The YAML ID conflicts with this note or is duplicated. The catalog identity is retained.'
            : null)
        if (warning && !record.deletedAt) {
          this.issue(
            'metadata:' + record.id,
            warning,
            record.id,
            null,
            'metadata'
          )
        } else {
          this.catalog.dismiss('metadata:' + record.id)
        }
      }
    })
    if (changes.length) {
      const operation = await this.operations.prepare(
        changes,
        '',
        '',
        false,
        true
      )
      await this.operations.execute(operation)
    }
    const current = this.catalog.all()
    const documentsByPath = new Map(documents.map(doc => [doc.path, doc]))
    const currentByPath = new Map(
      current
        .filter(note => note.presence === 'present' && !note.redirectId)
        .map(note => [note.path, note])
    )
    const byVersion = new Map<string, CatalogNote[]>()
    for (const candidate of current.filter(
      note => note.presence === 'present' && !note.redirectId
    )) {
      const group = byVersion.get(candidate.version) ?? []
      group.push(candidate)
      byVersion.set(candidate.version, group)
    }
    for (const old of current.filter(
      note => note.presence === 'missing' && !note.redirectId && !note.deletedAt
    )) {
      const samePath = currentByPath.get(old.path)
      const matches = (byVersion.get(old.version) ?? []).filter(
        candidate => !documentsByPath.get(candidate.path)?.yamlId
      )
      const candidate =
        samePath ?? (matches.length === 1 ? matches[0] : undefined)
      this.issue(
        'missing:' + old.id,
        'File missing: ' +
          old.path +
          '. Choose a moved file, or confirm deletion.',
        old.id,
        candidate?.id ?? null
      )
    }
    for (const doc of documents) {
      const record = currentByPath.get(doc.path)
      if (!record || record.deletedAt || !changed.has(record.id)) continue
      const references = changes.length
        ? noteReferences((await this.files.read(doc.path)).text)
        : (doc.references ?? [])
      this.indexReferences(record.id, references, current)
    }
    for (const path of this.cache.keys()) {
      if (!livePaths.has(path)) this.cache.delete(path)
    }
    // Unreadable files stay visible through their issue, not as openable entries.
    const hiddenPaths = new Set(
      current.filter(note => note.deletedAt).map(note => note.path)
    )
    return entries.filter(
      entry =>
        !hiddenPaths.has(entry.path) &&
        this.unreadable.get(entry.path) !== entry.signature
    )
  }
  private indexLinks(id: string, text: string, snapshot?: CatalogNote[]) {
    this.indexReferences(id, noteReferences(text), snapshot)
  }
  private indexReferences(
    id: string,
    refs: NoteReference[],
    snapshot?: CatalogNote[]
  ) {
    const record = this.record(id)
    const oldLinks = this.catalog.links(id)
    if (!refs.length) {
      if (oldLinks.length) this.catalog.setLinks(id, [])
      return
    }
    const records = (snapshot ?? this.catalog.all()).filter(
      note => !note.redirectId
    )
    const paths = records
      .filter(note => note.presence === 'present')
      .map(note => note.path)
    const links = refs
      .filter(ref => !ref.image)
      .map(ref => {
        const target = referenceTarget(ref, record.path, paths)
        const old = oldLinks.filter(link => sameReference(link.reference, ref))
        const duplicates = refs.filter(other =>
          sameReference(ref, other)
        ).length
        if (
          old.length === duplicates &&
          old[0]?.targetId &&
          !old.some(link => link.ambiguous) &&
          new Set(old.map(link => link.targetId)).size === 1
        ) {
          return { ...old[0], reference: ref }
        }
        const changedOccurrence =
          old.length === 0 &&
          oldLinks.some(
            link =>
              link.reference.href === ref.href &&
              link.targetId &&
              (this.record(link.targetId).presence !== 'present' ||
                this.record(link.targetId).path !== target?.path)
          )
        const ambiguous =
          changedOccurrence ||
          (old.length > 0 &&
            (old.length !== duplicates ||
              new Set(old.map(link => link.targetId)).size > 1))
        if (ambiguous) {
          return {
            reference: ref,
            targetId: null,
            targetPath: target?.path ?? null,
            anchor: target?.anchor ?? '',
            ambiguous: true
          }
        }
        const present = target
          ? records.find(
              note => note.presence === 'present' && note.path === target.path
            )
          : undefined
        const historical =
          target && !present
            ? [
                ...new Set([
                  ...this.catalog.historical(target.path),
                  ...records
                    .filter(
                      note =>
                        note.path === target.path && note.presence !== 'present'
                    )
                    .map(note => note.id)
                ])
              ]
            : []
        return {
          reference: ref,
          targetId:
            present?.id ?? (historical.length === 1 ? historical[0] : null),
          targetPath: target?.path ?? null,
          anchor: target?.anchor ?? '',
          ambiguous: historical.length > 1
        }
      })
      .filter(
        link =>
          link.targetPath?.toLowerCase().endsWith('.md') ||
          link.reference.format === 'wiki'
      )
    this.catalog.setLinks(id, links)
  }
  private revision(entries: { path: string; signature: string }[]) {
    return sha256Hex(
      JSON.stringify([
        entries,
        this.catalog
          .all()
          .map(note => [
            note.id,
            note.path,
            note.version,
            note.presence,
            note.deletedAt
          ])
      ])
    )
  }
  index(): Promise<Omit<NotesIndex, 'warning'>> {
    return this.run(async () => {
      const entries = await this.synchronize()
      const records = this.catalog.all()
      const recordsByPath = new Map(
        records
          .filter(note => note.presence === 'present' && !note.redirectId)
          .map(note => [note.path, note])
      )
      return {
        storage: this.files.root,
        storageId: this.catalog.storageId,
        revision: this.revision(entries),
        issues: this.catalog
          .issues()
          .filter(
            issue => !issue.noteId || !this.record(issue.noteId).deletedAt
          ),
        entries: entries.map(entry => {
          const record = recordsByPath.get(entry.path)
          const metadata = entry.folder
            ? { tags: [], error: null }
            : (this.cache.get(entry.path)?.metadata ?? {
                tags: [],
                error: null
              })
          return {
            path: entry.path,
            folder: entry.folder,
            ...metadata,
            ...(record ? { id: record.id, presence: record.presence } : {})
          }
        })
      }
    })
  }
  descriptor(id: string, storageId: string) {
    return this.run(async () => {
      this.assertStorage(storageId)
      await this.synchronize()
      const registered = this.record(id)
      const note = registered.deletedAt
        ? { ...registered, presence: 'deleted' as const }
        : registered.presence === 'present' &&
            !(await this.files.exists(registered.path))
          ? { ...registered, presence: 'missing' as const }
          : registered
      const backlinks = this.catalog
        .all()
        .filter(
          source =>
            source.presence === 'present' &&
            !source.deletedAt &&
            this.catalog
              .links(source.id)
              .some(
                link =>
                  link.targetId !== null &&
                  link.targetId !== '' &&
                  this.record(link.targetId).id === note.id
              )
        )
      return { note, backlinks }
    })
  }
  resolvePath(path: string) {
    return this.run(async () => {
      await this.synchronize()
      const records = this.catalog.all().filter(note => !note.redirectId)
      const candidates = new Set([
        ...records.filter(note => note.path === path).map(note => note.id),
        ...this.catalog.historical(path)
      ])
      if (!candidates.size) {
        throw new NotFoundError('The note path was not found.')
      }
      if (candidates.size !== 1) {
        throw new BadRequestError(
          'This path belongs to more than one note over time. Open a stable UUID link instead.'
        )
      }
      const record = this.record([...candidates][0])
      return record.deletedAt
        ? { ...record, presence: 'deleted' as const }
        : record
    })
  }
  assertStorage(id: string) {
    if (id !== this.catalog.storageId) {
      throw new BadRequestError(
        'This link belongs to a different notes storage.'
      )
    }
  }
  readId(id: string, storageId: string): Promise<Note> {
    return this.run(async () => {
      this.assertStorage(storageId)
      await this.synchronize()
      const record = this.record(id)
      if (record.presence !== 'present' || record.deletedAt) {
        throw new NotFoundError('The note file is missing or deleted.')
      }
      return {
        ...(await this.files.read(record.path)),
        id: record.id,
        storageId
      }
    })
  }
  readPath(path: string): Promise<Note> {
    return this.run(async () => {
      await this.synchronize()
      const record = this.catalog
        .all()
        .find(
          note =>
            note.path === path &&
            note.presence === 'present' &&
            !note.redirectId
        )
      if (!record || record.deletedAt) {
        throw new NotFoundError('Note not found.')
      }
      return {
        ...(await this.files.read(path)),
        id: record.id,
        storageId: this.catalog.storageId
      }
    })
  }
  save(
    path: string,
    text: string,
    version?: string,
    id?: string
  ): Promise<Note> {
    return this.run(async () => {
      const metadata = noteMetadata(text)
      if (metadata.error) throw new BadRequestError(metadata.error)
      await this.files.path(path)
      await this.writer.acquire(true)
      await this.synchronize()
      if (id) {
        const identified = this.record(id)
        if (identified.deletedAt) {
          throw new NotFoundError('This note was deleted.')
        }
        path = identified.path
      }
      let record = this.catalog
        .all()
        .find(
          note =>
            note.path === path &&
            note.presence === 'present' &&
            !note.redirectId
        )
      if (
        this.catalog.all().some(note => note.path === path && note.deletedAt)
      ) {
        throw new NoteExistsError()
      }
      if (version === undefined) {
        portablePath(path)
        if (record) throw new NoteExistsError()
        record = newRecord(randomUUID(), path, '')
        text = withNoteIdentity(text, record.id)
      }
      if (!record) throw new NotFoundError('Note identity not found.')
      await this.writer.assertOwner()
      const disk = await this.files.save(path, text, version)
      this.catalog.put({
        ...record,
        version: disk.version,
        updatedAt: new Date().toISOString()
      })
      this.indexLinks(record.id, disk.text)
      return { ...disk, id: record.id, storageId: this.catalog.storageId }
    })
  }
  saveId(id: string, storageId: string, text: string, version: string) {
    this.assertStorage(storageId)
    return this.save(this.record(id).path, text, version, id)
  }
  folder(path: string) {
    return this.run(async () => {
      portablePath(path)
      await this.files.path(path, false)
      await this.writer.acquire(true)
      await this.writer.assertOwner()
      await this.files.folder(path)
    })
  }
  rename(
    path: string,
    name: string,
    folder: boolean,
    target?: string,
    id?: string,
    expectedRevision?: string
  ): Promise<NoteMutation> {
    return this.run(async () => {
      const entries = await this.synchronize()
      if (expectedRevision && expectedRevision !== this.revision(entries)) {
        throw new NoteConflictError()
      }
      if (id && this.record(id).path !== path) throw new NoteConflictError()
      if (
        !folder &&
        this.catalog.all().some(note => note.path === path && note.deletedAt)
      ) {
        throw new NotFoundError('This note was deleted.')
      }
      if (
        !target &&
        (name !== name.trim() ||
          name.includes('/') ||
          name.includes('\\') ||
          name.startsWith('.'))
      ) {
        throw new BadRequestError('Invalid entry name.')
      }
      const sourcePath = await this.files.path(path, !folder)
      if (path.split('/')[0] === 'assets') {
        throw new BadRequestError('Cannot rename attachments.')
      }
      const sourceStat = await lstat(sourcePath)
      if (folder ? !sourceStat.isDirectory() : !sourceStat.isFile()) {
        throw new BadRequestError('Entry type changed.')
      }
      const destination = target ?? noteChildPath(noteParentPath(path), name)
      portablePath(destination)
      await this.files.path(destination, !folder)
      if (destination === path) {
        return { operationId: randomUUID(), complete: true }
      }
      if (
        this.catalog
          .all()
          .some(note => note.deletedAt && note.path === destination)
      ) {
        throw new NoteExistsError()
      }
      if (await this.files.exists(destination)) {
        const caseOnly =
          process.platform === 'win32' &&
          path.toLowerCase() === destination.toLowerCase() &&
          (await this.files.sameEntry(path, destination))
        if (!caseOnly) throw new NoteExistsError()
      }
      if (folder && destination.startsWith(path + '/')) {
        throw new BadRequestError('Cannot move a directory into itself.')
      }
      const moves = this.catalog
        .all()
        .filter(
          note =>
            note.presence === 'present' &&
            (note.path === path || (folder && note.path.startsWith(path + '/')))
        )
        .map(note => ({
          id: note.id,
          from: note.path,
          to: destination + note.path.slice(path.length)
        }))
      const operation = await this.operations.prepare(
        moves,
        path,
        destination,
        folder,
        false
      )
      let complete
      try {
        complete = await this.operations.execute(operation)
      } catch (error) {
        if (
          !operation.moved &&
          !(await this.files.exists(destination)) &&
          (!operation.temporary ||
            !(await this.files.exists(operation.temporary)))
        ) {
          this.catalog.finishOperation(operation.id)
        }
        throw error
      }
      return { operationId: operation.id, complete }
    })
  }
  deleteId(id: string, storageId: string) {
    return this.run(async () => {
      this.assertStorage(storageId)
      await this.synchronize()
      const note = this.record(id)
      if (note.deletedAt) return
      await this.writer.acquire(true)
      await this.writer.assertOwner()
      if (
        this.catalog
          .operations()
          .some(
            operation =>
              operation.moves.some(move => move.id === note.id) ||
              operation.writes.some(
                write => write.id === note.id && !write.done
              )
          )
      ) {
        throw new NoteConflictError()
      }
      // The note leaves its name, so a new note can use it. The catalog keeps the identity.
      // Only a present file exists on disk and needs the move.
      const path = deletedNotePath(note.path, randomUUID())
      if (note.presence === 'present' && !note.redirectId) {
        await this.files.moveEntry(note.path, path, false)
      }
      this.catalog.put({
        ...note,
        path,
        deletedAt: new Date().toISOString()
      })
      this.catalog.dismiss('missing:' + note.id, true)
      this.catalog.dismiss('metadata:' + note.id)
    })
  }
  retry() {
    return this.run(() => this.operations.retry())
  }
  resolveIdentity(issueId: string, restore: boolean, candidateId?: string) {
    return this.run(async () => {
      await this.synchronize()
      const issue = this.catalog.issues().find(item => item.id === issueId)
      if (!issue || issue.kind !== 'identity' || !issue.noteId) {
        throw new BadRequestError('Identity candidate is no longer available.')
      }
      const old = this.record(issue.noteId)
      if (old.presence === 'present') throw new NoteConflictError()
      const selectedCandidate = candidateId ?? issue.candidateId
      if (!selectedCandidate) {
        if (restore) throw new BadRequestError('Select the moved file first.')
        this.catalog.put({ ...old, presence: 'deleted' })
        this.catalog.dismiss(issueId, true)
        return
      }
      const candidate = this.record(selectedCandidate)
      if (candidate.presence !== 'present') throw new NoteConflictError()
      if (restore) {
        await this.files.read(candidate.path)
        const changes = [{ id: old.id, from: old.path, to: candidate.path }]
        const previousLinks = this.catalog.links(old.id)
        const candidateLinks = this.catalog.links(candidate.id).map(link => {
          const previous = previousLinks.filter(item =>
            sameReference(item.reference, link.reference)
          )
          return previous.length === 1
            ? { ...previous[0], reference: link.reference }
            : link
        })
        const preview = this.catalog
          .all()
          .filter(note => note.id !== old.id && note.id !== candidate.id)
        preview.push({
          ...old,
          path: candidate.path,
          version: candidate.version,
          presence: 'present'
        })
        const operation = await this.operations.prepare(
          changes,
          '',
          '',
          false,
          true,
          preview,
          {
            previousId: old.id,
            candidateId: candidate.id,
            version: candidate.version,
            links: candidateLinks
          }
        )
        await this.operations.execute(operation)
      }
      this.catalog.dismiss(issueId, true)
    })
  }
  resolve(
    sourceId: string,
    storageId: string,
    text: string,
    href: string,
    occurrence?: number
  ) {
    return this.run(async () => {
      this.assertStorage(storageId)
      await this.synchronize()
      const source = this.record(sourceId)
      if (source.deletedAt) throw new NotFoundError('This note was deleted.')
      const paths = this.catalog
        .all()
        .filter(
          note =>
            note.presence === 'present' && !note.redirectId && !note.deletedAt
        )
        .map(note => note.path)
      const refs = noteReferences(text)
        .flatMap(ref =>
          (ref.displayStarts ?? [ref.start]).map(displayPosition => ({
            ...ref,
            displayPosition
          }))
        )
        .sort((a, b) => a.displayPosition - b.displayPosition)
        .filter(
          ref =>
            !ref.image &&
            (ref.href === href ||
              (() => {
                const target = referenceTarget(ref, source.path, paths)
                const clicked = referenceTarget(
                  { ...ref, format: 'markdown', href },
                  source.path,
                  paths
                )
                return (
                  target !== null &&
                  target.path === clicked?.path &&
                  target.anchor === clicked.anchor
                )
              })())
        )
      const links = this.catalog.links(source.id)
      const candidates =
        occurrence === undefined ? refs : refs.slice(occurrence, occurrence + 1)
      const targets = new Set<string>()
      let anchor = ''
      for (const ref of candidates) {
        const known = links.filter(link => sameReference(link.reference, ref))
        if (
          known.some(link => link.ambiguous) ||
          new Set(known.map(link => link.targetId)).size > 1
        ) {
          throw new BadRequestError(
            'This link is ambiguous. Choose its target explicitly.'
          )
        }
        const target = referenceTarget(ref, source.path, paths)
        anchor = target?.anchor ?? ''
        const old = known[0]
        anchor = old?.anchor ?? anchor
        if (old?.targetId) {
          targets.add(this.record(old.targetId).id)
          continue
        }
        // A changed context with the same old address must not hijack a missing target.
        if (
          links.some(
            link =>
              link.reference.href === ref.href &&
              link.targetId &&
              (this.record(link.targetId).presence !== 'present' ||
                this.record(link.targetId).path !== target?.path)
          )
        ) {
          throw new BadRequestError(
            'The previous target is missing and this occurrence cannot be identified safely.'
          )
        }
        const present = this.catalog
          .all()
          .find(
            note =>
              note.presence === 'present' &&
              note.path === target?.path &&
              !note.redirectId
          )
        if (present) targets.add(present.id)
      }
      if (!refs.length && href.startsWith('#')) {
        targets.add(source.id)
        anchor = href.slice(1)
      }
      if (targets.size !== 1) {
        throw new BadRequestError(
          'This link is missing or ambiguous. Edit its destination to choose a note.'
        )
      }
      return { id: [...targets][0], anchor: safeDecodeURIComponent(anchor) }
    })
  }
  graph() {
    return this.run(async () => {
      await this.synchronize()
      const nodes = this.catalog
        .all()
        .filter(note => !note.redirectId && !note.deletedAt)
      const edges = nodes
        .filter(note => note.presence === 'present')
        .flatMap(note =>
          this.catalog.links(note.id).flatMap(link =>
            link.targetId && !this.record(link.targetId).deletedAt
              ? [
                  {
                    sourceId: note.id,
                    targetId: this.record(link.targetId).id
                  }
                ]
              : []
          )
        )
      return { storageId: this.catalog.storageId, nodes, edges }
    })
  }
}
