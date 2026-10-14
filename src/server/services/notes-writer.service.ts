import {
  open,
  readFile,
  unlink,
  mkdir,
  realpath,
  lstat
} from 'node:fs/promises'
import { join } from 'node:path'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { isRecord } from '../../shared/utils/guards.ts'
import { BadRequestError } from '../errors/http.ts'
import { isSystemError } from '../utils/system-error.ts'

// Same-process instances must also honor the filesystem writer lock.
const OWNERS = new Set<string>()

async function readOwner(path: string) {
  if ((await lstat(path)).isSymbolicLink()) {
    throw new BadRequestError('Notes writer lock cannot be a symbolic link.')
  }
  const text = await readFile(path, 'utf8')
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    typeof value.pid !== 'number' ||
    typeof value.host !== 'string' ||
    typeof value.token !== 'string'
  ) {
    throw new BadRequestError(
      'Invalid notes writer lock. Verify its owner before removing it.'
    )
  }
  return { pid: value.pid, host: value.host, token: value.token, text }
}

export class NotesWriter {
  private root: string | null = null
  private readonly token = randomUUID()
  private readonly configuredRoot: string
  constructor(configuredRoot: string) {
    this.configuredRoot = configuredRoot
  }
  async acquire(create = false) {
    if (this.root) return this.assertOwner()
    if (create) await mkdir(this.configuredRoot, { recursive: true })
    let root
    try {
      root = await realpath(this.configuredRoot)
    } catch (error) {
      if (isSystemError(error, 'ENOENT')) return
      throw error
    }
    if (OWNERS.has(root)) {
      throw new BadRequestError(
        'This notes storage already has an active writer.'
      )
    }
    const path = join(root, '.githuman-writer.lock')
    const data = JSON.stringify({
      pid: process.pid,
      host: hostname(),
      token: this.token
    })
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const file = await open(path, 'wx', 0o600)
        try {
          await file.writeFile(data)
          await file.sync()
        } finally {
          await file.close()
        }
        this.root = root
        OWNERS.add(root)
        return
      } catch (error) {
        if (!isSystemError(error, 'EEXIST')) throw error
        const owner = await readOwner(path)
        const old = owner.text
        if (
          owner.host !== hostname() ||
          !Number.isSafeInteger(owner.pid) ||
          owner.pid <= 0
        ) {
          throw new BadRequestError(
            'Notes writer lock belongs to another host or has invalid ownership.'
          )
        }
        try {
          process.kill(owner.pid, 0)
        } catch (killError) {
          if (isSystemError(killError, 'ESRCH')) {
            if ((await readFile(path, 'utf8')) === old) await unlink(path)
            continue
          }
          throw killError
        }
        throw new BadRequestError(
          'This notes storage already has an active writer.'
        )
      }
    }
    throw new BadRequestError('Could not acquire the notes writer lock.')
  }
  async assertOwner() {
    if (!this.root) throw new BadRequestError('Notes writer is not active.')
    const data = await readOwner(join(this.root, '.githuman-writer.lock'))
    if (data.token !== this.token) {
      throw new BadRequestError('Notes writer ownership changed.')
    }
  }
  async close() {
    if (!this.root) return
    try {
      await this.assertOwner()
      await unlink(join(this.root, '.githuman-writer.lock'))
    } catch (error) {
      if (!isSystemError(error, 'ENOENT')) throw error
    }
    OWNERS.delete(this.root)
    this.root = null
  }
}
