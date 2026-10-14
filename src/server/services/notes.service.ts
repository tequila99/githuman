import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { appendFile, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { createTestDatabase } from '../db/index.ts'
import { NotesIdentityService } from './notes-identity.service.ts'
import { NotesRepository } from '../repositories/notes.repo.ts'
import { noteMetadata } from '../../shared/notes/document.ts'
import type { NotesIndex } from '../../shared/notes/types.ts'
import type { EventBus } from '../event-bus.ts'
import { BadRequestError } from '../errors/http.ts'
import { errorMessage } from '../../shared/utils/error-message.ts'
import { MAX_NOTE_ASSET_BYTES } from '../../shared/notes/constants.ts'
import { detectNoteAssetFormat } from '../utils/note-asset-format.ts'

const execFileAsync = promisify(execFile)

export class NotesService {
  readonly repository: NotesRepository
  private inspected: Promise<void> | undefined
  private exclusion: Promise<void> | undefined
  readonly identity: NotesIdentityService
  private snapshotValue = ''
  private warning: string | null = null
  readonly projectPath: string
  readonly root: string
  private readonly local: boolean
  private readonly bus: EventBus
  constructor(
    projectPath: string,
    root: string,
    local: boolean,
    bus: EventBus,
    db: DatabaseSync = createTestDatabase()
  ) {
    this.projectPath = projectPath
    this.root = root
    this.local = local
    this.bus = bus
    this.repository = new NotesRepository(root)
    this.identity = new NotesIdentityService(this.repository, db)
  }

  private async visibility(ensureIgnored = false): Promise<void> {
    try {
      const { stdout: gitRoot } = await execFileAsync(
        'git',
        ['rev-parse', '--show-toplevel'],
        { cwd: this.projectPath }
      )
      const path = relative(gitRoot.trim(), this.root).replaceAll('\\', '/')
      if (path.startsWith('../')) return
      const { stdout: tracked } = await execFileAsync(
        'git',
        ['ls-files', '--', path + '/'],
        { cwd: gitRoot.trim() }
      )
      if (tracked && this.local) {
        this.warning =
          'Some notes are already tracked by Git. Ignoring them does not remove them from Git.'
      }
      if (!this.local || !ensureIgnored) return
      const { stdout: exclude } = await execFileAsync(
        'git',
        ['rev-parse', '--git-path', 'info/exclude'],
        { cwd: this.projectPath }
      )
      const target = resolve(this.projectPath, exclude.trim())
      const rule = '/' + path.replace(/[*?[\]#! ]/g, char => '\\' + char) + '/'
      const content = await readFile(target, 'utf8').catch(() => '')
      if (!content.split(/\r?\n/).includes(rule)) {
        await appendFile(target, '\n' + rule + '\n')
      }
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          'stderr' in error &&
          String(error.stderr).includes('not a git repository')
        )
      ) {
        this.warning = 'Could not verify Git exclusion: ' + errorMessage(error)
      }
    }
  }

  async index(): Promise<NotesIndex> {
    this.inspected ??= this.visibility()
    await this.inspected
    const index = await this.identity.index()
    this.snapshotValue = JSON.stringify([
      index,
      this.identity.catalog
        .all()
        .map(note => [note.id, note.version, note.presence]),
      this.warning
    ])
    return { ...index, warning: this.warning }
  }
  async snapshot(): Promise<string> {
    await this.index()
    return this.snapshotValue
  }
  read(path: string) {
    return this.identity.readPath(path)
  }
  async save(
    path: string,
    text: string,
    version?: string,
    id?: string,
    storageId?: string
  ) {
    await this.repository.path(path)
    const metadata = noteMetadata(text)
    if (metadata.error) throw new BadRequestError(metadata.error)
    this.exclusion ??= this.visibility(true)
    await this.exclusion
    const note =
      id && storageId && version !== undefined
        ? await this.identity.saveId(id, storageId, text, version)
        : await this.identity.save(path, text, version)
    this.bus.publish({ type: 'notes:changed' })
    return note
  }
  async uploadAsset(bytes: Buffer) {
    if (!bytes.length || bytes.length > MAX_NOTE_ASSET_BYTES) {
      throw new BadRequestError('Image must be under 10 MB')
    }
    const format = await detectNoteAssetFormat(bytes)
    this.exclusion ??= this.visibility(true)
    await this.exclusion
    const id = await this.identity.run(async () => {
      await this.repository.path('assets/probe.png', false)
      await this.identity.writer.acquire(true)
      await this.identity.writer.assertOwner()
      return this.repository.saveAsset(bytes, format.extension)
    })
    return { url: '/api/notes/assets/' + id }
  }
  readAsset(id: string) {
    return this.repository.readAsset(id)
  }
  async rename(
    path: string,
    name: string,
    folder: boolean,
    target?: string,
    id?: string,
    revision?: string
  ) {
    const result = await this.identity.rename(
      path,
      name,
      folder,
      target,
      id,
      revision
    )
    this.bus.publish({ type: 'notes:changed' })
    return result
  }
  async folder(path: string) {
    await this.repository.path(path, false)
    this.exclusion ??= this.visibility(true)
    await this.exclusion
    await this.identity.folder(path)
    this.bus.publish({ type: 'notes:changed' })
  }
}
