import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { isSafePrefixedFilename } from '../../shared/utils/is-safe-prefixed-filename.ts'
import { isValidFilenamePrefix } from '../../shared/utils/is-valid-filename-prefix.ts'
import { MAX_ARTIFACT_BYTES } from '../../shared/artifacts/constants.ts'
import {
  ArtifactInputError,
  ArtifactIntegrityError
} from '../errors/artifacts.ts'
import { hasErrorCode } from '../utils/system-error.ts'
import { sha256Hex } from '../utils/hash.ts'
import { resolveWithinRepo } from '../services/git.service.ts'

export class ArtifactFilesRepository {
  readonly repositoryPath: string
  readonly root: string
  readonly prefix: string

  constructor(repositoryPath: string, prefix: string) {
    if (!isValidFilenamePrefix(prefix)) {
      throw new ArtifactInputError('Invalid artifact filename prefix.')
    }
    this.repositoryPath = realpathSync(repositoryPath)
    this.prefix = prefix
    this.root = resolveWithinRepo(this.repositoryPath, '.githuman/artifacts')
  }

  private directory(create: boolean): boolean {
    for (const path of [join(this.repositoryPath, '.githuman'), this.root]) {
      try {
        if (create) {
          try {
            mkdirSync(path, { mode: 0o700 })
            this.syncDirectory(join(path, '..'))
          } catch (error) {
            if (!hasErrorCode(error, 'EEXIST')) throw error
          }
        }
        const info = lstatSync(path)
        if (
          info.isSymbolicLink() ||
          !info.isDirectory() ||
          realpathSync(path) !== path
        ) {
          throw new ArtifactIntegrityError(
            'Artifact storage directory is not a regular directory.'
          )
        }
      } catch (error) {
        if (hasErrorCode(error, 'ENOENT')) return false
        throw error
      }
    }
    return true
  }

  private path(name: string): string {
    if (!isSafePrefixedFilename(name, this.prefix)) {
      throw new ArtifactInputError('Invalid artifact file name.')
    }
    return resolveWithinRepo(this.repositoryPath, `.githuman/artifacts/${name}`)
  }

  read(name: string): Buffer | undefined {
    if (!this.directory(false)) return undefined
    const path = this.path(name)
    let fd: number
    try {
      if (lstatSync(path).isSymbolicLink()) {
        throw new ArtifactIntegrityError(
          'Symbolic artifact files are not supported.'
        )
      }
      fd = openSync(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      )
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return undefined
      if (hasErrorCode(error, 'ELOOP')) {
        throw new ArtifactIntegrityError(
          'Symbolic artifact files are not supported.'
        )
      }
      throw error
    }
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) {
        throw new ArtifactIntegrityError(
          'Artifact file has an invalid size or type.'
        )
      }
      const buffer = Buffer.alloc(stat.size + 1)
      let count = 0
      while (count < buffer.length) {
        const bytes = readSync(fd, buffer, count, buffer.length - count, count)
        if (!bytes) break
        count += bytes
      }
      if (count !== stat.size) {
        throw new ArtifactIntegrityError(
          'Artifact file changed during reading.'
        )
      }
      return buffer.subarray(0, count)
    } finally {
      closeSync(fd)
    }
  }

  verify(name: string, hash: string, bytes: number): Buffer {
    const content = this.read(name)
    if (!content || content.length !== bytes || sha256Hex(content) !== hash) {
      throw new ArtifactIntegrityError(
        'Artifact file is missing or its hash does not match.'
      )
    }
    return content
  }

  writeTemp(name: string, content: Buffer): void {
    this.directory(true)
    const fd = openSync(
      this.path(name),
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600
    )
    try {
      writeFileSync(fd, content)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    this.syncDirectory()
  }

  publish(temp: string, name: string, hash: string, bytes: number): void {
    this.verify(temp, hash, bytes)
    this.syncFile(temp)
    try {
      linkSync(this.path(temp), this.path(name))
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw error
      this.verify(name, hash, bytes)
    }
    this.syncDirectory()
  }

  removeTemp(name: string): void {
    if (!name.endsWith('.tmp')) {
      throw new ArtifactInputError(
        'Only an operation temporary file may be removed.'
      )
    }
    if (!this.directory(false)) return
    const path = this.path(name)
    try {
      if (lstatSync(path).isSymbolicLink()) {
        throw new ArtifactIntegrityError(
          'Symbolic artifact files are not supported.'
        )
      }
      unlinkSync(path)
      this.syncDirectory()
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error
    }
  }

  names(): string[] {
    return this.directory(false)
      ? readdirSync(this.root).filter(name => name.startsWith(this.prefix))
      : []
  }

  syncFile(name: string): void {
    this.directory(false)
    // Windows needs a writable handle to flush file contents.
    const fd = openSync(
      this.path(name),
      constants.O_RDWR | constants.O_NOFOLLOW
    )
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    // Recovery can find a link created before the previous directory flush.
    this.syncDirectory()
  }

  private syncDirectory(path = this.root): void {
    // Windows does not support opening directories for fsync through this API.
    if (process.platform === 'win32') return
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  }
}
