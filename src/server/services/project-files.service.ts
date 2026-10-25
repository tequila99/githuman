import { open, realpath, stat, type FileHandle } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, isAbsolute } from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError
} from '../errors/http.ts'
import { resolveWithinRepo } from './git.service.ts'
import { isMissingPathError } from '../utils/system-error.ts'
import { decodeText } from '../utils/text.ts'
import { isMarkdownPath } from '../../shared/utils/markdown-path.ts'
import {
  PROJECT_DOWNLOAD_MIME,
  PROJECT_IMAGE_LIMIT,
  PROJECT_PDF_LIMIT,
  PROJECT_TEXT_LIMIT
} from '../../shared/project-files/constants.ts'
import type { ProjectFileMetadata } from '../../shared/project-files/types.ts'

// A small prefix identifies preview formats without reading the complete file.
const PREFIX_BYTES = 8192
// A backslash or a control character cannot be part of a project path.
const UNSAFE_PATH_PATTERN = /[\\\p{Cc}]/u
// Documents that can run scripts. They are never previewed, only downloaded.
const ACTIVE_DOCUMENT_PATTERN = /\.(html?|svg|xhtml)$/i
// Linux resolves an open file descriptor to the real path of its file.
const PROC_FD_DIR = '/proc/self/fd'
// MIME type of a previewed text file.
const TEXT_MIME = 'text/plain; charset=utf-8'
// Only passive raster formats can use the image viewer.
const IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon'
])

export class ProjectFilesService {
  private readonly repositoryPath: string
  constructor(repositoryPath: string) {
    this.repositoryPath = repositoryPath
  }

  // A file above the preview limit is never previewed, so its prefix is enough.
  private isPrefixText(prefix: Buffer) {
    try {
      return !new TextDecoder('utf-8', { fatal: true })
        .decode(prefix, { stream: true })
        .includes('\0')
    } catch {
      return false
    }
  }

  // Reads the rest of a small file so that NUL or bad UTF-8 after the prefix is found.
  private async isWholeFileText(
    file: FileHandle,
    prefix: Buffer,
    size: number
  ) {
    const whole = Buffer.alloc(size)
    prefix.copy(whole)
    let offset = prefix.length
    while (offset < size) {
      const { bytesRead } = await file.read(
        whole,
        offset,
        size - offset,
        offset
      )
      if (bytesRead === 0) {
        throw new ForbiddenError('File changed while opening')
      }
      offset += bytesRead
    }
    return decodeText(whole) !== null
  }

  async open(path: string): Promise<{
    file: FileHandle
    metadata: ProjectFileMetadata
    limit: number
  }> {
    if (isAbsolute(path) || UNSAFE_PATH_PATTERN.test(path)) {
      throw new BadRequestError('Invalid project file path')
    }
    let file: FileHandle | undefined
    try {
      const root = await realpath(this.repositoryPath)
      let target: string
      try {
        target = await realpath(resolveWithinRepo(root, path))
        resolveWithinRepo(root, target)
      } catch (error) {
        if (isMissingPathError(error)) throw error
        throw new ForbiddenError('File leaves the repository')
      }
      const before = await stat(target)
      if (!before.isFile()) {
        throw new BadRequestError('Project path is not a regular file')
      }
      file = await open(
        target,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      )
      const info = await file.stat()
      if (
        !info.isFile() ||
        info.dev !== before.dev ||
        info.ino !== before.ino
      ) {
        throw new ForbiddenError('File changed while opening')
      }
      const opened = await realpath(
        process.platform === 'linux' ? `${PROC_FD_DIR}/${file.fd}` : target
      )
      try {
        resolveWithinRepo(root, opened)
      } catch {
        throw new ForbiddenError('File leaves the repository')
      }
      const prefix = Buffer.alloc(Math.min(info.size, PREFIX_BYTES))
      const { bytesRead } = await file.read(prefix, 0, prefix.length, 0)
      if (bytesRead !== prefix.length) {
        throw new ForbiddenError('File changed while opening')
      }
      const detected = await fileTypeFromBuffer(prefix).catch(() => undefined)
      let kind: ProjectFileMetadata['kind'] = 'download'
      let mime = PROJECT_DOWNLOAD_MIME
      let limit = 0
      if (detected?.mime === 'application/pdf') {
        kind = 'pdf'
        mime = detected.mime
        limit = PROJECT_PDF_LIMIT
      } else if (detected && IMAGE_MIMES.has(detected.mime)) {
        kind = 'image'
        mime = detected.mime
        limit = PROJECT_IMAGE_LIMIT
      } else if (
        !detected &&
        !ACTIVE_DOCUMENT_PATTERN.test(path) &&
        (info.size <= PROJECT_TEXT_LIMIT
          ? await this.isWholeFileText(file, prefix, info.size)
          : this.isPrefixText(prefix))
      ) {
        kind = isMarkdownPath(path) ? 'markdown' : 'text'
        mime = TEXT_MIME
        limit = PROJECT_TEXT_LIMIT
      }
      return {
        file,
        metadata: {
          name: basename(path),
          size: info.size,
          kind,
          mime,
          previewable: kind !== 'download' && info.size <= limit
        },
        limit
      }
    } catch (error) {
      await file?.close()
      if (isMissingPathError(error)) {
        throw new NotFoundError('Project file was deleted or moved')
      }
      throw error
    }
  }
}
