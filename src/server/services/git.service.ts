import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
import { simpleGit } from 'simple-git'
import type { DiffFileStatus, RepositoryInfo } from '../../shared/types.ts'

const execFileAsync = promisify(execFile)

/**
 * Resolves `path` against `repoPath` and rejects anything that escapes the
 * repository root (e.g. `../../etc/passwd`), since `path` here is untrusted
 * input coming straight off the HTTP request.
 */
function resolveWithinRepo(repoPath: string, path: string): string {
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
  path: string
): Promise<FileAtRef> {
  if (ref === 'WORKTREE') {
    try {
      const absolutePath = resolveWithinRepo(repoPath, path)
      const buffer = await readFile(absolutePath)
      return {
        content: buffer.includes(0) ? '' : buffer.toString('utf-8'),
        isBinary: buffer.includes(0)
      }
    } catch {
      return { content: '', isBinary: false }
    }
  }

  if (ref !== 'INDEX') {
    assertSafeRef(ref)
  }
  const gitRef = ref === 'INDEX' ? `:${path}` : `${ref}:${path}`

  try {
    // No `--` before gitRef: for the INDEX form (`:path`) it would make git
    // treat the pathspec-looking `:path` as a plain path instead of the
    // special "file staged in the index" syntax, silently changing meaning
    // (falls back to showing HEAD). assertSafeRef above already rules out
    // the injection this would otherwise guard against.
    const { stdout } = await execFileAsync('git', ['show', gitRef], {
      cwd: repoPath,
      encoding: 'buffer',
      maxBuffer: 1024 * 1024 * 100
    })

    const isBinary = stdout.includes(0)

    return {
      content: isBinary ? '' : stdout.toString('utf-8'),
      isBinary
    }
  } catch {
    return { content: '', isBinary: false }
  }
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
  const results: ChangedPath[] = []
  let i = 0
  while (i < tokens.length) {
    const code = tokens[i++]
    const status = statusCodeToStatus(code)

    if (code[0] === 'R' || code[0] === 'C') {
      const oldPath = tokens[i++]
      const newPath = tokens[i++]
      results.push({ oldPath, newPath, status })
    } else {
      const path = tokens[i++]
      results.push({ oldPath: path, newPath: path, status })
    }
  }

  return results
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
