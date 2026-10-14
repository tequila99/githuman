import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  lstat,
  link,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { BadRequestError, NotFoundError } from '../errors/http.ts'
import { isSystemError } from '../utils/system-error.ts'
import { sha256Hex } from '../utils/hash.ts'
import { NoteConflictError, NoteExistsError } from '../errors/notes.ts'
import type { Note } from '../../shared/notes/types.ts'
import { MAX_NOTE_ASSET_BYTES } from '../../shared/notes/constants.ts'
import type { NoteAssetExtension } from '../../shared/notes/asset-formats.ts'

// Bound file reads before allocating document buffers.
const MAX_BYTES = 1000000

export class NotesRepository {
  readonly root: string
  private readonly writes = new Map<string, Promise<unknown>>()
  constructor(root: string) {
    this.root = resolve(root)
  }

  async path(path: string, markdown = true): Promise<string> {
    if (
      !path ||
      path.includes('\\') ||
      path.includes('\0') ||
      path.startsWith('/') ||
      path
        .split('/')
        .some(
          part => !part || part === '.' || part === '..' || part.startsWith('.')
        ) ||
      (markdown && !path.toLowerCase().endsWith('.md'))
    ) {
      throw new BadRequestError('Invalid note path')
    }
    const target = resolve(this.root, path)
    if (!target.startsWith(this.root + sep)) {
      throw new BadRequestError('Path leaves the notes folder')
    }
    // Reject links in every existing component, including the configured root.
    let current = resolve(this.root).split(sep)[0] || sep
    for (const part of target
      .slice(current.length)
      .split(sep)
      .filter(Boolean)) {
      current = join(current, part)
      try {
        if ((await lstat(current)).isSymbolicLink()) {
          throw new BadRequestError(
            'Symbolic links are not supported in the notes path'
          )
        }
      } catch (error) {
        if (!isSystemError(error, 'ENOENT')) throw error
      }
    }
    return target
  }

  async read(path: string): Promise<Note> {
    const target = await this.path(path)
    try {
      const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > MAX_BYTES) {
          throw new BadRequestError('Note must be a Markdown file under 1 MB')
        }
        const bytes = await file.readFile()
        if (bytes.byteLength > MAX_BYTES) {
          throw new BadRequestError('Note exceeds 1 MB')
        }
        const text = new TextDecoder('utf-8', {
          fatal: true,
          ignoreBOM: true
        }).decode(bytes)
        return { path, text, version: sha256Hex(text) }
      } finally {
        await file.close()
      }
    } catch (error) {
      if (isSystemError(error, 'ENOENT')) {
        throw new NotFoundError('Note not found')
      }
      throw error
    }
  }

  async list(): Promise<
    { path: string; folder: boolean; signature: string }[]
  > {
    const result: { path: string; folder: boolean; signature: string }[] = []
    await this.path('probe.md')
    const walk = async (dir: string, prefix: string) => {
      const entries = (await readdir(dir, { withFileTypes: true })).filter(
        entry =>
          !entry.name.startsWith('.') &&
          !entry.isSymbolicLink() &&
          (prefix || entry.name !== 'assets')
      )
      for (const entry of entries.filter(item => item.isDirectory())) {
        const path = prefix + entry.name
        await this.path(path, false)
        result.push({ path, folder: true, signature: 'folder' })
        await walk(join(dir, entry.name), path + '/')
      }
      const files = entries.filter(
        entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md')
      )
      // Bound concurrent metadata reads while retaining path checks for each file.
      for (let offset = 0; offset < files.length; offset += 16) {
        const batch = await Promise.allSettled(
          files.slice(offset, offset + 16).map(async entry => {
            const path = prefix + entry.name
            const target = await this.path(path)
            const stat = await lstat(target, { bigint: true })
            return {
              path,
              folder: false,
              signature: `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
            }
          })
        )
        for (const item of batch) {
          if (item.status === 'rejected') throw item.reason
          result.push(item.value)
        }
      }
    }
    await walk(this.root, '')
    return result.sort((a, b) => a.path.localeCompare(b.path))
  }

  private async serial<T>(path: string, run: () => Promise<T>): Promise<T> {
    const prior = this.writes.get(path) ?? Promise.resolve()
    const next = prior.catch(() => {}).then(run)
    this.writes.set(path, next)
    try {
      return await next
    } finally {
      if (this.writes.get(path) === next) this.writes.delete(path)
    }
  }

  async save(path: string, text: string, expected?: string): Promise<Note> {
    return this.serial(path, async () => {
      if (Buffer.byteLength(text) > MAX_BYTES) {
        throw new BadRequestError('Note exceeds 1 MB')
      }
      const target = await this.path(path)
      await mkdir(dirname(target), { recursive: true })
      await this.path(path)
      let current: Note | undefined
      if (expected !== undefined) {
        try {
          current = await this.read(path)
        } catch (error) {
          if (error instanceof NotFoundError) throw new NoteConflictError()
          throw error
        }
        if (current.version !== expected) throw new NoteConflictError()
        if (current.text === text) return current
        // Retain one previous version per note, without accumulating autosave history.
        const backups = join(this.root, '.history')
        await mkdir(backups, { recursive: true })
        if (
          (await lstat(backups)).isSymbolicLink() ||
          !(await realpath(backups)).startsWith(this.root + sep)
        ) {
          throw new BadRequestError('Invalid backup folder')
        }
        const backupTemp = join(backups, '.backup-' + randomUUID())
        try {
          await writeFile(backupTemp, current.text, { flag: 'wx', mode: 0o600 })
          await rename(backupTemp, join(backups, sha256Hex(path) + '.md'))
        } finally {
          await unlink(backupTemp).catch(error => {
            if (!isSystemError(error, 'ENOENT')) throw error
          })
        }
      }
      const temporary = join(dirname(target), '.note-' + randomUUID())
      try {
        const file = await open(temporary, 'wx', 0o600)
        try {
          await file.writeFile(text)
          await file.sync()
        } finally {
          await file.close()
        }
        await this.path(path)
        if (expected === undefined) {
          try {
            await link(temporary, target)
          } catch (error) {
            if (isSystemError(error, 'EEXIST')) throw new NoteExistsError()
            throw error
          }
        } else {
          if ((await this.read(path)).version !== expected) {
            throw new NoteConflictError()
          }
          await rename(temporary, target)
        }
      } finally {
        await unlink(temporary).catch(error => {
          if (!isSystemError(error, 'ENOENT')) throw error
        })
      }
      return { path, text, version: sha256Hex(text) }
    })
  }

  async saveAsset(
    bytes: Buffer,
    extension: NoteAssetExtension
  ): Promise<string> {
    const id = sha256Hex(bytes.toString('base64')) + '.' + extension
    const target = await this.path('assets/' + id, false)
    await mkdir(dirname(target), { recursive: true })
    await this.path('assets/' + id, false)
    const temporary = join(dirname(target), '.asset-' + randomUUID())
    try {
      const file = await open(temporary, 'wx', 0o600)
      try {
        await file.writeFile(bytes)
        await file.sync()
      } finally {
        await file.close()
      }
      await this.path('assets/' + id, false)
      try {
        await link(temporary, target)
      } catch (error) {
        if (!isSystemError(error, 'EEXIST')) throw error
      }
    } finally {
      await unlink(temporary).catch(error => {
        if (!isSystemError(error, 'ENOENT')) throw error
      })
    }
    return id
  }

  async readAsset(id: string): Promise<Buffer> {
    const target = await this.path('assets/' + id, false)
    try {
      const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > MAX_NOTE_ASSET_BYTES) {
          throw new BadRequestError('Invalid image attachment')
        }
        return await file.readFile()
      } finally {
        await file.close()
      }
    } catch (error) {
      if (isSystemError(error, 'ENOENT')) {
        throw new NotFoundError('Attachment not found')
      }
      throw error
    }
  }

  async sameEntry(path: string, other: string): Promise<boolean> {
    const a = await lstat(await this.path(path, false))
    const b = await lstat(await this.path(other, false))
    return a.dev === b.dev && a.ino === b.ino
  }
  async exactEntry(path: string): Promise<boolean> {
    const target = await this.path(path, false)
    try {
      return (await readdir(dirname(target))).includes(basename(target))
    } catch (error) {
      if (isSystemError(error, 'ENOENT')) return false
      throw error
    }
  }
  async exists(path: string): Promise<boolean> {
    const target = await this.path(path, false)
    try {
      await lstat(target)
      return true
    } catch (error) {
      if (isSystemError(error, 'ENOENT')) return false
      throw error
    }
  }

  async moveEntry(path: string, destination: string, folder: boolean) {
    const source = await this.path(path, !folder)
    const target = await this.path(destination, !folder)
    if (
      destination.split('/')[0] === 'assets' ||
      path.split('/')[0] === 'assets'
    ) {
      throw new BadRequestError('Cannot move attachments')
    }
    if (folder && destination.startsWith(path + '/')) {
      throw new BadRequestError('Cannot move a folder into itself')
    }
    if (path === destination) return
    if (await this.exists(destination)) throw new NoteExistsError()
    const stat = await lstat(source)
    if (folder ? !stat.isDirectory() : !stat.isFile()) {
      throw new BadRequestError('Entry type changed')
    }
    await mkdir(dirname(target), { recursive: true })
    await this.path(destination, !folder)
    if (folder) {
      await rename(source, target)
    } else {
      try {
        await link(source, target)
      } catch (error) {
        if (isSystemError(error, 'EEXIST')) throw new NoteExistsError()
        throw error
      }
      await unlink(source)
    }
  }

  async renameEntry(
    path: string,
    name: string,
    folder: boolean
  ): Promise<string> {
    return this.serial('rename', async () => {
      if (
        !name.trim() ||
        name !== name.trim() ||
        /[/\\\0]/.test(name) ||
        name.startsWith('.')
      ) {
        throw new BadRequestError('Invalid entry name')
      }
      if (path.split('/')[0] === 'assets') {
        throw new BadRequestError('Cannot rename attachments')
      }
      const targetPath = [...path.split('/').slice(0, -1), name].join('/')
      if (targetPath.split('/')[0] === 'assets') {
        throw new BadRequestError('Reserved folder name')
      }
      const source = await this.path(path, !folder)
      const target = await this.path(targetPath, !folder)
      let stat
      try {
        stat = await lstat(source)
      } catch (error) {
        if (isSystemError(error, 'ENOENT')) {
          throw new NotFoundError('Note entry not found')
        }
        throw error
      }
      if (folder ? !stat.isDirectory() : !stat.isFile()) {
        throw new BadRequestError('Entry type changed')
      }
      if (path === targetPath) return targetPath
      try {
        await lstat(target)
        throw new NoteExistsError()
      } catch (error) {
        if (!isSystemError(error, 'ENOENT')) throw error
      }
      if (folder) {
        await rename(source, target)
      } else {
        try {
          await link(source, target)
        } catch (error) {
          if (isSystemError(error, 'EEXIST')) throw new NoteExistsError()
          throw error
        }
        await unlink(source)
      }
      return targetPath
    })
  }

  async folder(path: string): Promise<void> {
    const target = await this.path(path, false)
    await mkdir(dirname(target), { recursive: true })
    await this.path(path, false)
    try {
      await mkdir(target)
    } catch (error) {
      if (isSystemError(error, 'EEXIST')) throw new NoteExistsError()
      throw error
    }
  }
}
