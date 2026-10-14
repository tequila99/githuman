import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import type { NotesRepository } from '../repositories/notes.repo.ts'
import type {
  NotesCatalogRepository,
  CatalogNote,
  NoteOperation
} from '../repositories/notes-catalog.repo.ts'
import type { NotesWriter } from './notes-writer.service.ts'
import {
  noteReferences,
  referenceTarget,
  rewriteReferences,
  sameReference
} from '../../shared/notes/references.ts'
import type { Note } from '../../shared/notes/types.ts'
import { NotFoundError } from '../errors/http.ts'
import { NoteConflictError, NoteExistsError } from '../errors/notes.ts'
import { errorMessage } from '../../shared/utils/error-message.ts'

export class NotesOperationsService {
  readonly files: NotesRepository
  readonly catalog: NotesCatalogRepository
  readonly writer: NotesWriter
  readonly record: (id: string) => CatalogNote
  readonly changed: (id: string, note: Note) => void
  constructor(options: {
    files: NotesRepository
    catalog: NotesCatalogRepository
    writer: NotesWriter
    record: (id: string) => CatalogNote
    changed: (id: string, note: Note) => void
  }) {
    this.files = options.files
    this.catalog = options.catalog
    this.writer = options.writer
    this.record = options.record
    this.changed = options.changed
  }
  private issue(
    id: string,
    message: string,
    noteId: string | null,
    _candidate: null,
    _kind: 'rewrite'
  ) {
    this.catalog.issue({
      id,
      message,
      noteId,
      candidateId: null,
      kind: 'rewrite'
    })
  }
  async prepare(
    moves: NoteOperation['moves'],
    source: string,
    target: string,
    folder: boolean,
    moved: boolean,
    preview?: CatalogNote[],
    restore?: NoteOperation['restore']
  ): Promise<NoteOperation> {
    const operation: NoteOperation = {
      id: randomUUID(),
      moves: moves.map(move => ({
        ...move,
        version: this.record(move.id).version
      })),
      source,
      target,
      folder,
      moved,
      committed: false,
      writes: []
    }
    if (restore) operation.restore = restore
    const records = (preview ?? this.catalog.all()).filter(
      note => note.presence === 'present' && !note.redirectId
    )
    const oldPath = (note: CatalogNote) =>
      moves.find(move => move.id === note.id)?.from ?? note.path
    const newPath = (note: CatalogNote) =>
      moves.find(move => move.id === note.id)?.to ?? note.path
    const oldPaths = records.map(oldPath)
    for (const record of records) {
      const disk = await this.files.read(moved ? record.path : oldPath(record))
      if (!moved && disk.version !== record.version) {
        throw new NoteConflictError()
      }
      const refs = noteReferences(disk.text)
      const links = this.catalog.links(record.id)
      const changes = []
      for (const ref of refs) {
        const matches = links.filter(link => sameReference(link.reference, ref))
        if (matches.some(link => link.ambiguous)) continue
        const known =
          new Set(matches.map(link => link.targetId)).size === 1
            ? matches[0]
            : undefined
        const resolved = referenceTarget(ref, oldPath(record), oldPaths)
        const targetRecord = known?.targetId
          ? this.catalog.get(known.targetId)
          : records.find(note => oldPath(note) === resolved?.path)
        let destination = targetRecord ? newPath(targetRecord) : resolved?.path
        if (
          destination &&
          !targetRecord &&
          source &&
          (destination === source ||
            (folder && destination.startsWith(source + '/')))
        ) {
          destination = target + destination.slice(source.length)
        }
        if (!destination) continue
        if (
          newPath(record) !== oldPath(record) ||
          (targetRecord && newPath(targetRecord) !== oldPath(targetRecord)) ||
          destination !== resolved?.path
        ) {
          changes.push({
            reference: ref,
            from: newPath(record),
            target: destination,
            anchor: known?.anchor ?? resolved?.anchor ?? ''
          })
        }
      }
      const after = rewriteReferences(disk.text, changes)
      if (after !== disk.text) {
        operation.writes.push({
          id: record.id,
          path: newPath(record),
          before: disk.text,
          after,
          done: false
        })
      }
    }
    if (source) {
      const stat = await lstat(
        await this.files.path(moved ? target : source, false)
      )
      operation.sourceFingerprint = stat.dev + ':' + stat.ino
    }
    this.catalog.operation(operation)
    return operation
  }
  async execute(operation: NoteOperation): Promise<boolean> {
    await this.writer.assertOwner()
    if (!operation.moved) {
      const caseOnly =
        process.platform === 'win32' &&
        operation.source !== operation.target &&
        operation.source.toLowerCase() === operation.target.toLowerCase()
      if (caseOnly && !operation.temporary) {
        operation.temporary = [
          ...operation.source.split('/').slice(0, -1),
          '__ght-case-' + operation.id + (operation.folder ? '' : '.md')
        ].join('/')
        this.catalog.operation(operation)
      }
      let fromPath = operation.source
      if (operation.temporary) {
        if (await this.files.exists(operation.temporary)) {
          fromPath = operation.temporary
        } else if (!(await this.files.exactEntry(operation.target))) {
          const stat = await lstat(
            await this.files.path(operation.source, false)
          )
          if (
            operation.sourceFingerprint &&
            operation.sourceFingerprint !== stat.dev + ':' + stat.ino
          ) {
            throw new NoteConflictError()
          }
          for (const move of operation.moves) {
            const disk = await this.files.read(move.from)
            if (move.version && disk.version !== move.version) {
              throw new NoteConflictError()
            }
          }
          await this.files.moveEntry(
            operation.source,
            operation.temporary,
            operation.folder
          )
          fromPath = operation.temporary
        }
      }
      const from = await this.files.exists(fromPath)
      const to = await this.files.exists(operation.target)
      if (from && to && !caseOnly) throw new NoteExistsError()
      const physical =
        from && !(caseOnly && (await this.files.exactEntry(operation.target)))
          ? fromPath
          : operation.target
      if (!(await this.files.exists(physical))) {
        throw new NotFoundError(
          'Both operation paths are missing. Recovery needs manual attention.'
        )
      }
      if (operation.sourceFingerprint) {
        const stat = await lstat(await this.files.path(physical, false))
        if (operation.sourceFingerprint !== stat.dev + ':' + stat.ino) {
          throw new NoteConflictError()
        }
      }
      for (const move of operation.moves) {
        const actual =
          physical === operation.target
            ? move.to
            : fromPath + move.from.slice(operation.source.length)
        const disk = await this.files.read(actual)
        if (move.version && disk.version !== move.version) {
          throw new NoteConflictError()
        }
      }
      if (physical !== operation.target) {
        await this.files.moveEntry(fromPath, operation.target, operation.folder)
      }
      operation.moved = true
      this.catalog.operation(operation)
    }
    if (!operation.committed) {
      if (operation.restore) {
        const candidate = this.catalog.get(operation.restore.candidateId)
        if (
          !candidate ||
          candidate.presence !== 'present' ||
          (await this.files.read(candidate.path)).version !==
            operation.restore.version
        ) {
          throw new NoteConflictError()
        }
      }
      this.catalog.transaction(() => {
        if (operation.restore) {
          const candidate = this.record(operation.restore.candidateId)
          this.catalog.put({
            ...candidate,
            presence: 'missing',
            redirectId: operation.restore.previousId
          })
        }
        for (const move of operation.moves) {
          const record = this.record(move.id)
          this.catalog.put({ ...record, presence: 'missing' })
        }
        for (const move of operation.moves) {
          const record = this.record(move.id)
          this.catalog.put({ ...record, path: move.to, presence: 'present' })
          this.catalog.history(record.id, move.from, move.to, operation.id)
        }
        if (operation.restore) {
          this.catalog.setLinks(
            operation.restore.previousId,
            operation.restore.links
          )
        }
        operation.committed = true
        this.catalog.operation(operation)
      })
    }
    let complete = true
    for (const write of operation.writes) {
      if (write.done) continue
      try {
        await this.writer.assertOwner()
        const disk = await this.files.read(write.path)
        if (disk.text === write.after) {
          write.done = true
        } else if (disk.text === write.before) {
          await this.files.save(write.path, write.after, disk.version)
          write.done = true
        } else {
          throw new NoteConflictError()
        }
        this.catalog.dismiss('rewrite:' + operation.id + ':' + write.id)
        this.catalog.operation(operation)
        const fresh = await this.files.read(write.path)
        this.changed(write.id, fresh)
      } catch (error) {
        complete = false
        this.issue(
          'rewrite:' + operation.id + ':' + write.id,
          'Relative links need repair: ' + errorMessage(error),
          write.id,
          null,
          'rewrite'
        )
      }
    }
    if (complete) {
      this.catalog.dismiss('operation:' + operation.id)
      this.catalog.finishOperation(operation.id)
    }
    return complete
  }
  async recover() {
    for (const operation of this.catalog.operations()) {
      try {
        await this.execute(operation)
      } catch (error) {
        this.issue(
          'operation:' + operation.id,
          'File operation needs attention: ' + errorMessage(error),
          operation.moves[0]?.id ?? null,
          null,
          'rewrite'
        )
      }
    }
  }
  async retry() {
    await this.writer.acquire()
    const paths = this.catalog
      .all()
      .filter(note => !note.redirectId)
      .map(note => note.path)
    for (const operation of this.catalog.operations()) {
      if (!operation.moved || !operation.committed) continue
      for (const write of operation.writes.filter(item => !item.done)) {
        const disk = await this.files.read(write.path)
        if (disk.text === write.before || disk.text === write.after) continue
        const before = noteReferences(write.before)
        const after = noteReferences(write.after)
        const current = noteReferences(disk.text)
        const changes = []
        let safe = before.length === after.length
        for (let i = 0; i < before.length && safe; i++) {
          const old = before[i]
          const next = after[i]
          if (old.href === next.href) continue
          const matches = current.filter(ref => sameReference(ref, old))
          const corrected = current.filter(ref => sameReference(ref, next))
          if (matches.length === 0 && corrected.length === 1) continue
          const target = referenceTarget(next, write.path, paths)
          if (matches.length !== 1 || !target) {
            safe = false
            break
          }
          changes.push({
            reference: matches[0],
            from: write.path,
            target: target.path,
            anchor: target.anchor
          })
        }
        if (!safe) continue
        write.before = disk.text
        write.after = rewriteReferences(disk.text, changes)
        this.catalog.operation(operation)
      }
    }
    await this.recover()
  }
}
