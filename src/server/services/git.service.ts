import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { basename, posix, resolve, sep } from 'node:path'
import { simpleGit } from 'simple-git'
import type { DiffFileStatus } from '../../shared/diff/types.ts'
import type { RepositoryInfo } from '../../shared/git/types.ts'
import { GitFileNotFoundError } from '../errors/git.ts'
import { isBinaryBuffer } from '../utils/text.ts'

const execFileAsync = promisify(execFile)

/**
 * Resolves `path` against `repoPath` and rejects anything that escapes the
 * repository root (e.g. `../../etc/passwd`), since `path` here is untrusted
 * input coming straight off the HTTP request.
 */
export function resolveWithinRepo(repoPath: string, path: string): string {
  const repoRoot = resolve(repoPath)
  const resolved = resolve(repoRoot, path)
  if (resolved !== repoRoot && !resolved.startsWith(repoRoot + sep)) {
    throw new Error(`Path "${path}" escapes the repository root`)
  }
  return resolved
}

/**
 * Rejects a git ref/revision string that could be misparsed as a command
 * option by git itself (e.g. `--output=/etc/passwd` smuggled in as a
 * "branch name"). No real branch, tag, or SHA can start with `-` — git
 * itself refuses to create one (`git branch -- -foo` errors with "not a
 * valid branch name") — so any ref starting with `-` is definitely hostile
 * input, not a legitimate ref a caller could have meant.
 */
export function assertSafeRef(ref: string): void {
  if (ref.startsWith('-')) {
    throw new Error(`Invalid git ref "${ref}": refs may not start with "-"`)
  }
}

export interface FileAtRef {
  content: string
  isBinary: boolean
}

export interface ChangedPath {
  oldPath: string
  newPath: string
  status: DiffFileStatus
}

/**
 * Builds the `git show`/`cat-file` object spec for a file at a ref (e.g.
 * `HEAD:src/foo.ts`, or `:src/foo.ts` for the INDEX/staged form). Shared by
 * `getFileAtRef` and `getFilesAtRefBatch` so both single-file and batched
 * reads resolve refs identically.
 */
function objectSpecFor(ref: string, path: string): string {
  if (ref !== 'INDEX') {
    assertSafeRef(ref)
  }
  // No `--` before the spec: for the INDEX form (`:path`) it would make git
  // treat the pathspec-looking `:path` as a plain path instead of the
  // special "file staged in the index" syntax, silently changing meaning
  // (falls back to showing HEAD). assertSafeRef above already rules out
  // the injection this would otherwise guard against.
  return ref === 'INDEX' ? `:${path}` : `${ref}:${path}`
}

/** `ENOENT` and `ENOTDIR` both mean that the file does not exist. */
function isMissingPathError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

/**
 * Checks one path with `ls-tree` instead of listing the whole tree. A failing
 * `ls-tree` means the ref is invalid, so the path is reported as present and
 * the caller keeps the original error.
 */
async function pathExistsAtRef(
  repoPath: string,
  ref: string,
  path: string
): Promise<boolean> {
  const normalized = posix.normalize(path)
  try {
    const args =
      ref === 'INDEX'
        ? ['ls-files', '-z', '--', `:(literal)${normalized}`]
        : ['ls-tree', '-z', ref, '--', normalized]
    const { stdout } = await execFileAsync('git', args, { cwd: repoPath })
    return stdout.length > 0
  } catch {
    return true
  }
}

/**
 * Reads a file's content at a given git ref.
 *
 * `ref` may be any git ref/SHA, or the literal string 'INDEX' to read the
 * staged (index) version of the file instead of a committed ref.
 *
 * If the path does not exist at that ref (e.g. a newly added file has no
 * HEAD version), returns empty content rather than throwing — the caller
 * treats this as "the file did not exist on this side of the diff".
 */
export async function getFileAtRef(
  repoPath: string,
  ref: string,
  path: string,
  strict = false
): Promise<FileAtRef> {
  if (ref === 'WORKTREE') {
    try {
      const absolutePath = resolveWithinRepo(repoPath, path)
      const buffer = await readFile(absolutePath)
      const isBinary = isBinaryBuffer(buffer)
      return { content: isBinary ? '' : buffer.toString('utf-8'), isBinary }
    } catch (error) {
      if (strict) {
        if (isMissingPathError(error))
          throw new GitFileNotFoundError('File was deleted or moved', {
            cause: error
          })
        throw error
      }
      return { content: '', isBinary: false }
    }
  }

  const gitRef = objectSpecFor(ref, path)

  try {
    const { stdout } = await execFileAsync('git', ['show', gitRef], {
      cwd: repoPath,
      encoding: 'buffer',
      maxBuffer: 1024 * 1024 * 100
    })

    const isBinary = isBinaryBuffer(stdout)

    return {
      content: isBinary ? '' : stdout.toString('utf-8'),
      isBinary
    }
  } catch (error) {
    if (strict) {
      if (!(await pathExistsAtRef(repoPath, ref, path)))
        throw new GitFileNotFoundError('File was deleted or moved', {
          cause: error
        })
      throw error
    }
    return { content: '', isBinary: false }
  }
}

/**
 * Parses `git cat-file --batch`'s output for `count` requested objects, in
 * request order. Each entry is either `<sha> SP <type> SP <size> LF`
 * followed by exactly `size` bytes of content and a trailing LF, or
 * `<object> SP missing LF` (or another non-numeric-size error line, e.g.
 * `ambiguous`/`notdir`) for a request that didn't resolve — treated the
 * same as a missing file, matching `getFileAtRef`'s catch-all behavior.
 *
 * Parses by the announced byte size, not line-by-line — file content can
 * itself contain arbitrary bytes, including `\n`.
 */
function parseCatFileBatchOutput(buffer: Buffer, count: number): FileAtRef[] {
  const results: FileAtRef[] = []
  let offset = 0

  for (let i = 0; i < count; i++) {
    const headerEnd = buffer.indexOf(0x0a, offset)
    if (headerEnd === -1) {
      throw new Error('git cat-file --batch: truncated output (missing header)')
    }
    const header = buffer.toString('utf-8', offset, headerEnd)
    offset = headerEnd + 1

    const size = Number(header.slice(header.lastIndexOf(' ') + 1))
    if (!Number.isInteger(size) || size < 0) {
      results.push({ content: '', isBinary: false })
      continue
    }

    const content = buffer.subarray(offset, offset + size)
    if (content.length < size) {
      throw new Error('git cat-file --batch: truncated output (short content)')
    }
    offset += size + 1 // skip content + its trailing LF

    const isBinary = isBinaryBuffer(content)
    results.push({
      content: isBinary ? '' : content.toString('utf-8'),
      isBinary
    })
  }

  return results
}

/**
 * Reads many files' content at git refs in one `git cat-file --batch`
 * process, instead of one `git show` process per file (see ADR 0019) —
 * used by `buildDiffFiles` to avoid spawning `2 × changed files` processes
 * for a single diff. Results come back in the same order as `requests`.
 *
 * Does not accept `ref: 'WORKTREE'` — worktree content isn't a git object;
 * callers read it directly off disk instead (as `getFileAtRef` already
 * does for that ref).
 */
export async function getFilesAtRefBatch(
  repoPath: string,
  requests: { ref: string; path: string }[]
): Promise<FileAtRef[]> {
  if (requests.length === 0) return []

  const specs = requests.map(({ ref, path }) => {
    if (ref === 'WORKTREE') {
      throw new Error(
        "getFilesAtRefBatch does not support ref 'WORKTREE' — read worktree files directly instead"
      )
    }
    return objectSpecFor(ref, path)
  })

  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd: repoPath })
    const chunks: Buffer[] = []
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        reject(
          new Error(`git cat-file --batch exited with code ${code}: ${stderr}`)
        )
        return
      }
      try {
        resolvePromise(
          parseCatFileBatchOutput(Buffer.concat(chunks), requests.length)
        )
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })

    // git may exit before reading stdin (e.g. not a repository): the EPIPE
    // would crash the process, and 'close' already reports the failure.
    child.stdin.on('error', () => {})
    child.stdin.write(specs.join('\n') + '\n')
    child.stdin.end()
  })
}

/**
 * Lists every file path visible at a git ref, for browsing the whole
 * codebase rather than just a diff. `'WORKTREE'` lists the working directory
 * (tracked + untracked, honoring .gitignore, matching `getFileAtRef`'s
 * 'WORKTREE' semantics), `'INDEX'` lists the staged snapshot, and any other
 * ref lists that commit's tree.
 */
export async function getFilesAtRef(
  repoPath: string,
  ref: string
): Promise<string[]> {
  if (ref === 'WORKTREE') {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
        cwd: repoPath,
        encoding: 'utf-8'
      }
    )
    return [...new Set(stdout.split('\0').filter(Boolean))].sort()
  }

  if (ref === 'INDEX') {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '-z', '--cached'],
      { cwd: repoPath, encoding: 'utf-8' }
    )
    return stdout.split('\0').filter(Boolean).sort()
  }

  assertSafeRef(ref)
  const { stdout } = await execFileAsync(
    'git',
    ['ls-tree', '-r', '--name-only', '-z', '--', ref],
    {
      cwd: repoPath,
      encoding: 'utf-8'
    }
  )
  return stdout.split('\0').filter(Boolean).sort()
}

function statusCodeToStatus(code: string): DiffFileStatus {
  switch (code[0]) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    default:
      return 'modified'
  }
}

/**
 * Removes the extra record of a merge conflict. During a conflict, `git diff` prints an
 * `U` record with zero blob ids and also a normal record for the same path. The normal
 * record has the real blob ids and counts, so it stays.
 */
function dedupeUnmerged<T extends { newPath: string }>(
  records: { code: string; item: T }[]
): T[] {
  const normalPaths = new Set(
    records
      .filter(record => record.code !== 'U')
      .map(record => record.item.newPath)
  )
  return records
    .filter(
      record => record.code !== 'U' || !normalPaths.has(record.item.newPath)
    )
    .map(record => record.item)
}

export interface ChangedSummary extends ChangedPath {
  additions: number
  deletions: number
  isBinary: boolean
  /** Blob id of the old side: HEAD for `--cached`, the index for the worktree diff. */
  oldOid: string
  /** Blob id of the new side. Git prints all zeros when the new side is the worktree. */
  newOid: string
}

interface RawRecord extends ChangedPath {
  code: string
  oldOid: string
  newOid: string
}

interface NumstatRecord {
  /** The new path. For a rename, git prints both paths and this is the second one. */
  path: string
  additions: number
  deletions: number
  isBinary: boolean
}

/**
 * Parses the output of `git diff --raw --numstat -z`. Git prints all raw records first:
 * a `:<modes> <old oid> <new oid> <status>` token, then one path, or two for a rename or copy.
 * The numstat records follow: `<added>\t<removed>\t<path>` in one token. For a rename, the
 * path part is empty, and two path tokens follow. Paths are read by position, so a path
 * with `:`, a TAB or a line feed does not break the parse.
 */
export function parseRawNumstat(stdout: string): {
  raw: RawRecord[]
  numstat: NumstatRecord[]
} {
  const tokens = stdout.split('\0')
  // With -z, the output ends with NUL, so the last token is empty.
  if (tokens[tokens.length - 1] === '') tokens.pop()
  const raw: RawRecord[] = []
  const numstat: NumstatRecord[] = []
  let i = 0
  while (i < tokens.length && tokens[i].startsWith(':')) {
    const fields = tokens[i++].split(' ')
    const code = fields[4] ?? 'M'
    const oldOid = fields[2] ?? ''
    const newOid = fields[3] ?? ''
    const status = statusCodeToStatus(code)
    if (code[0] === 'R' || code[0] === 'C') {
      const oldPath = tokens[i++]
      const newPath = tokens[i++]
      raw.push({ code, oldPath, newPath, status, oldOid, newOid })
    } else {
      const path = tokens[i++]
      raw.push({ code, oldPath: path, newPath: path, status, oldOid, newOid })
    }
  }
  while (i < tokens.length) {
    const token = tokens[i++]
    // Only the first two TABs separate fields: a path can hold a TAB too.
    const firstTab = token.indexOf('\t')
    const secondTab = token.indexOf('\t', firstTab + 1)
    const added = token.slice(0, firstTab)
    const removed = token.slice(firstTab + 1, secondTab)
    let path = token.slice(secondTab + 1)
    if (path === '') {
      i++ // the old path of the rename
      path = tokens[i++]
    }
    const isBinary = added === '-'
    numstat.push({
      path,
      additions: isBinary ? 0 : Number(added),
      deletions: isBinary ? 0 : Number(removed),
      isBinary
    })
  }
  return { raw, numstat }
}

/**
 * Joins raw and numstat records. They come from one git run in the same order, so they
 * line up by position. A path mismatch means the parse went wrong: then the join goes by path.
 */
function joinRawNumstat(
  raw: RawRecord[],
  numstat: NumstatRecord[]
): { code: string; item: ChangedSummary }[] {
  const aligned =
    raw.length === numstat.length &&
    raw.every((record, i) => record.newPath === numstat[i].path)
  if (!aligned) {
    process.emitWarning(
      `git diff --raw --numstat: ${raw.length} raw and ${numstat.length} numstat records do not line up; joining by path`
    )
  }
  const byPath = aligned
    ? undefined
    : new Map(numstat.map(record => [record.path, record]))
  return raw.map(({ code, ...record }, i) => {
    const counts = aligned ? numstat[i] : byPath?.get(record.newPath)
    return {
      code,
      item: {
        ...record,
        additions: counts?.additions ?? 0,
        deletions: counts?.deletions ?? 0,
        isBinary: counts?.isBinary ?? false
      }
    }
  })
}

/**
 * Lists changed paths with line counts and both blob ids, without reading file contents.
 * One git run prints both formats, so the records describe one state of the repository.
 */
export async function listChangedSummaries(
  repoPath: string,
  diffArgs: string[]
): Promise<ChangedSummary[]> {
  const { stdout } = await execFileAsync(
    'git',
    ['diff', '--raw', '--numstat', '--no-abbrev', '-M', '-z', ...diffArgs],
    { cwd: repoPath, encoding: 'utf-8', maxBuffer: 1024 * 1024 * 100 }
  )
  const { raw, numstat } = parseRawNumstat(stdout)
  return dedupeUnmerged(joinRawNumstat(raw, numstat))
}

/**
 * Lists changed paths for a diff, given the git ref arguments that would
 * normally follow `git diff --name-status -M` (e.g. `['--cached']` for
 * staged changes, or `[base, 'HEAD']` for a branch comparison).
 */
export async function listChangedPaths(
  repoPath: string,
  diffArgs: string[]
): Promise<ChangedPath[]> {
  const { stdout } = await execFileAsync(
    'git',
    ['diff', '--name-status', '-M', '-z', ...diffArgs],
    {
      cwd: repoPath,
      encoding: 'utf-8'
    }
  )

  // With -z, git replaces both the record terminator and the inter-field
  // tab with NUL, so the whole output is a flat stream of NUL-separated
  // tokens: <status> <path>, or <status> <oldPath> <newPath> for renames.
  const tokens = stdout.split('\0').filter(token => token !== '')
  const results: { code: string; item: ChangedPath }[] = []
  let i = 0
  while (i < tokens.length) {
    const code = tokens[i++]
    const status = statusCodeToStatus(code)

    if (code[0] === 'R' || code[0] === 'C') {
      const oldPath = tokens[i++]
      const newPath = tokens[i++]
      results.push({ code, item: { oldPath, newPath, status } })
    } else {
      const path = tokens[i++]
      results.push({ code, item: { oldPath: path, newPath: path, status } })
    }
  }

  return dedupeUnmerged(results)
}

/** Lists paths that git has never tracked (respects .gitignore). */
export async function listUntrackedPaths(repoPath: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-files', '-z', '--others', '--exclude-standard'],
    {
      cwd: repoPath,
      encoding: 'utf-8'
    }
  )

  return stdout.split('\0').filter(path => path !== '')
}

/**
 * Stages the given paths (`git add -- <paths>`). With an empty array,
 * stages everything — tracked edits and untracked new files alike
 * (`git add -A`), matching the "Stage all" action in the UI.
 */
export async function stagePaths(
  repoPath: string,
  paths: string[]
): Promise<void> {
  const args = paths.length > 0 ? ['add', '--', ...paths] : ['add', '-A']
  await execFileAsync('git', args, { cwd: repoPath })
}

/**
 * Unstages the given paths (`git restore --staged -- <paths>`), leaving
 * their working-tree content untouched. With an empty array, unstages
 * everything, matching `stagePaths`'s "empty = everything" convention.
 */
export async function unstagePaths(
  repoPath: string,
  paths: string[]
): Promise<void> {
  const args =
    paths.length > 0
      ? ['restore', '--staged', '--', ...paths]
      : ['restore', '--staged', '.']
  await execFileAsync('git', args, { cwd: repoPath })
}

/**
 * Discards unstaged working-tree changes for the given paths: an untracked
 * file is deleted outright (`git clean`), a tracked file is restored to its
 * last-staged content (`git restore`). Paths are classified before either
 * git command runs, rather than running `restore` and swallowing a "not
 * found" error for the ones `clean` already removed — `git restore`
 * validates every pathspec up front, so if the batch mixed tracked and
 * untracked paths, an already-removed untracked path would abort the whole
 * call and silently no-op the legitimate tracked restores too.
 */
export async function discardPaths(
  repoPath: string,
  paths: string[]
): Promise<void> {
  if (paths.length === 0) return

  const untrackedPaths = new Set(await listUntrackedPaths(repoPath))
  const toClean = paths.filter(path => untrackedPaths.has(path))
  const toRestore = paths.filter(path => !untrackedPaths.has(path))

  if (toClean.length > 0) {
    await execFileAsync('git', ['clean', '-f', '-d', '--', ...toClean], {
      cwd: repoPath
    })
  }
  if (toRestore.length > 0) {
    await execFileAsync('git', ['restore', '--', ...toRestore], {
      cwd: repoPath
    })
  }
}

export async function getRepositoryInfo(
  repoPath: string
): Promise<RepositoryInfo> {
  const git = simpleGit(repoPath)
  const [branchSummary, remotes] = await Promise.all([
    git.branch(),
    git.getRemotes(true)
  ])
  const origin = remotes.find(remote => remote.name === 'origin')

  return {
    name: basename(repoPath),
    branch: branchSummary.current,
    remote: origin?.refs.fetch ?? null,
    path: repoPath
  }
}
