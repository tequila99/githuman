import { diffLines } from 'diff'
import { stat } from 'node:fs/promises'
import type {
  DiffFile,
  DiffFileSummary,
  DiffSourceName,
  DiffFileStatus,
  DiffHunk,
  DiffLine
} from '../../shared/diff/types.ts'
import {
  assertSafeRef,
  listChangedSummaries,
  resolveWithinRepo,
  getFileAtRef,
  getFilesAtRefBatch,
  listChangedPaths,
  listUntrackedPaths
} from './git.service.ts'
import type { ChangedSummary, FileAtRef } from './git.service.ts'

/** Unchanged lines kept around each change in a hunk, as in `git diff`. */
const CONTEXT_LINES = 3

/** Stamp of a worktree file that cannot be read. */
const GONE_STAMP = 'gone'

/**
 * Line count and binary flag of untracked files, by repository and path. A refetch runs on
 * every save, so an untracked file is read again only when its stamp changes.
 */
const untrackedCounts = new Map<
  string,
  { stamp: string; additions: number; isBinary: boolean }
>()

export interface DiffFileMeta {
  oldPath: string
  newPath: string
  status: DiffFileStatus
  isBinary: boolean
}

function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function windowHunks(
  lines: DiffLine[],
  contextLines = CONTEXT_LINES
): DiffHunk[] {
  if (lines.length === 0) return []

  const keep = Array.from<boolean>({ length: lines.length }).fill(false)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type === 'context') continue
    for (
      let j = Math.max(0, i - contextLines);
      j <= Math.min(lines.length - 1, i + contextLines);
      j++
    ) {
      keep[j] = true
    }
  }

  const hunks: DiffHunk[] = []
  let i = 0
  while (i < lines.length) {
    if (!keep[i]) {
      i += 1
      continue
    }
    let j = i
    while (j < lines.length && keep[j]) j += 1

    const segment = lines.slice(i, j)
    const oldNumbers = segment
      .map(l => l.oldLineNumber)
      .filter((n): n is number => n !== null)
    const newNumbers = segment
      .map(l => l.newLineNumber)
      .filter((n): n is number => n !== null)

    hunks.push({
      oldStart: oldNumbers.length > 0 ? oldNumbers[0] : 0,
      oldLines: oldNumbers.length,
      newStart: newNumbers.length > 0 ? newNumbers[0] : 0,
      newLines: newNumbers.length,
      lines: segment
    })

    i = j
  }

  return hunks
}

export function computeFileDiff(
  oldContent: string,
  newContent: string,
  meta: DiffFileMeta
): DiffFile {
  const base = {
    oldPath: meta.oldPath,
    newPath: meta.newPath,
    status: meta.status,
    isBinary: meta.isBinary
  }

  if (meta.isBinary) {
    return { ...base, additions: 0, deletions: 0, hunks: [] }
  }

  if (oldContent === newContent) {
    return { ...base, additions: 0, deletions: 0, hunks: [] }
  }

  const parts = diffLines(oldContent, newContent)

  let oldLineNumber = 1
  let newLineNumber = 1
  let additions = 0
  let deletions = 0
  const lines: DiffLine[] = []

  for (const part of parts) {
    for (const content of splitLines(part.value)) {
      if (part.added) {
        lines.push({
          type: 'added',
          content,
          oldLineNumber: null,
          newLineNumber
        })
        newLineNumber += 1
        additions += 1
      } else if (part.removed) {
        lines.push({
          type: 'removed',
          content,
          oldLineNumber,
          newLineNumber: null
        })
        oldLineNumber += 1
        deletions += 1
      } else {
        lines.push({ type: 'context', content, oldLineNumber, newLineNumber })
        oldLineNumber += 1
        newLineNumber += 1
      }
    }
  }

  const hunks = windowHunks(lines)

  return { ...base, additions, deletions, hunks }
}

/**
 * Reads one diff side's content for every changed path, batching all
 * git-ref reads into a single `git cat-file --batch` process instead of one
 * `git show` per file (see ADR 0019) — `WORKTREE` still reads straight off
 * disk (already process-free) since it isn't a git object. Falls back to
 * per-file `getFileAtRef` if the batch process fails to spawn or crashes
 * mid-read, so a batching problem degrades performance rather than
 * correctness.
 */
async function readDiffSide(
  repoPath: string,
  ref: string,
  paths: string[]
): Promise<FileAtRef[]> {
  if (ref === 'WORKTREE' || paths.length === 0) {
    return Promise.all(paths.map(path => getFileAtRef(repoPath, ref, path)))
  }

  try {
    return await getFilesAtRefBatch(
      repoPath,
      paths.map(path => ({ ref, path }))
    )
  } catch {
    return Promise.all(paths.map(path => getFileAtRef(repoPath, ref, path)))
  }
}

async function buildDiffFiles(
  repoPath: string,
  diffArgs: string[],
  oldRef: string,
  newRef: string
): Promise<DiffFile[]> {
  const changes = await listChangedPaths(repoPath, diffArgs)

  const [oldFiles, newFiles] = await Promise.all([
    readDiffSide(
      repoPath,
      oldRef,
      changes.map(change => change.oldPath)
    ),
    readDiffSide(
      repoPath,
      newRef,
      changes.map(change => change.newPath)
    )
  ])

  return changes.map((change, i) =>
    computeFileDiff(oldFiles[i].content, newFiles[i].content, {
      oldPath: change.oldPath,
      newPath: change.newPath,
      status: change.status,
      isBinary: oldFiles[i].isBinary || newFiles[i].isBinary
    })
  )
}

export async function getStagedDiff(repoPath: string): Promise<DiffFile[]> {
  return buildDiffFiles(repoPath, ['--cached'], 'HEAD', 'INDEX')
}

export async function getUnstagedDiff(repoPath: string): Promise<DiffFile[]> {
  const [trackedFiles, untrackedPaths] = await Promise.all([
    buildDiffFiles(repoPath, [], 'INDEX', 'WORKTREE'),
    listUntrackedPaths(repoPath)
  ])

  const untrackedFiles = await Promise.all(
    untrackedPaths.map(async path => {
      const worktreeFile = await getFileAtRef(repoPath, 'WORKTREE', path)
      return computeFileDiff('', worktreeFile.content, {
        oldPath: path,
        newPath: path,
        status: 'added',
        isBinary: worktreeFile.isBinary
      })
    })
  )

  return [...trackedFiles, ...untrackedFiles]
}

export async function getBranchDiff(
  repoPath: string,
  base: string
): Promise<DiffFile[]> {
  assertSafeRef(base)
  return buildDiffFiles(repoPath, [base, 'HEAD'], base, 'HEAD')
}

export async function getCommitsDiff(
  repoPath: string,
  from: string,
  to: string
): Promise<DiffFile[]> {
  assertSafeRef(from)
  assertSafeRef(to)
  return buildDiffFiles(repoPath, [from, to], from, to)
}

/**
 * `mtime:ctime:inode:size` of a file in the worktree. It costs no read. The inode catches
 * a file replaced by rename. Known limit: an edit of the same size within one timestamp
 * tick of the file system keeps the stamp.
 */
async function worktreeStamp(repoPath: string, path: string): Promise<string> {
  try {
    const info = await stat(resolveWithinRepo(repoPath, path))
    return `${info.mtimeMs}:${info.ctimeMs}:${info.ino}:${info.size}`
  } catch {
    return GONE_STAMP
  }
}

function countLines(content: string): number {
  return splitLines(content).length
}

/**
 * Builds a signature from both sides of the diff. Equal signatures must mean equal hunks,
 * so the old side counts too: a change of only HEAD or only the index changes the hunks.
 */
function signatureOf(
  change: Omit<ChangedSummary, 'newOid' | 'oldOid'>,
  oldSide: string,
  newSide: string
): string {
  return [
    change.status,
    change.oldPath,
    change.newPath,
    change.additions,
    change.deletions,
    oldSide,
    newSide
  ].join('|')
}

/** Counts the lines of an untracked file. The file is read only when its stamp changed. */
async function untrackedSummary(
  repoPath: string,
  path: string
): Promise<DiffFileSummary> {
  const stamp = await worktreeStamp(repoPath, path)
  const key = `${repoPath}\0${path}`
  let counts = untrackedCounts.get(key)
  if (!counts || counts.stamp !== stamp) {
    const file = await getFileAtRef(repoPath, 'WORKTREE', path)
    counts = {
      stamp,
      additions: file.isBinary ? 0 : countLines(file.content),
      isBinary: file.isBinary
    }
    if (stamp === GONE_STAMP) {
      untrackedCounts.delete(key)
    } else {
      untrackedCounts.set(key, counts)
    }
  }
  const change = {
    oldPath: path,
    newPath: path,
    status: 'added' as const,
    additions: counts.additions,
    deletions: 0,
    isBinary: counts.isBinary
  }
  return { ...change, signature: signatureOf(change, '', stamp) }
}

/** Drops the cached counts of files that are no longer untracked in this repository. */
function pruneUntrackedCounts(repoPath: string, untrackedPaths: string[]) {
  const prefix = `${repoPath}\0`
  const alive = new Set(untrackedPaths.map(path => prefix + path))
  for (const key of untrackedCounts.keys()) {
    if (key.startsWith(prefix) && !alive.has(key)) untrackedCounts.delete(key)
  }
}

/**
 * Lists the files of one diff side with counts and a signature, but no hunks (ADR 0033).
 * Counts come from git, the hunks of `getFileDiff` from `diffLines`: they may differ by a few lines.
 */
export async function getDiffSummaries(
  repoPath: string,
  source: DiffSourceName
): Promise<DiffFileSummary[]> {
  if (source === 'staged') {
    const changes = await listChangedSummaries(repoPath, ['--cached'])
    return changes.map(({ oldOid, newOid, ...change }) => ({
      ...change,
      signature: signatureOf(change, oldOid, newOid)
    }))
  }

  const [changes, untrackedPaths] = await Promise.all([
    listChangedSummaries(repoPath, []),
    listUntrackedPaths(repoPath)
  ])
  // The new side is the worktree: git prints zeros for its blob id, so a stamp stands in.
  const tracked = await Promise.all(
    changes.map(async ({ oldOid, newOid: _newOid, ...change }) => ({
      ...change,
      signature: signatureOf(
        change,
        oldOid,
        await worktreeStamp(repoPath, change.newPath)
      )
    }))
  )
  const untracked = await Promise.all(
    untrackedPaths.map(path => untrackedSummary(repoPath, path))
  )
  pruneUntrackedCounts(repoPath, untrackedPaths)
  return [...tracked, ...untracked]
}

/**
 * Builds the diff of one file. The caller passes the summary's paths and status, so no
 * whole-repository listing runs per file. Untracked files have no index entry: their old side is empty.
 */
export async function getFileDiff(
  repoPath: string,
  source: DiffSourceName,
  meta: Pick<DiffFileMeta, 'oldPath' | 'newPath' | 'status'>
): Promise<DiffFile> {
  const [oldRef, newRef] =
    source === 'staged' ? ['HEAD', 'INDEX'] : ['INDEX', 'WORKTREE']
  const [oldFile, newFile] = await Promise.all([
    getFileAtRef(repoPath, oldRef, meta.oldPath),
    getFileAtRef(repoPath, newRef, meta.newPath)
  ])
  return computeFileDiff(oldFile.content, newFile.content, {
    ...meta,
    isBinary: oldFile.isBinary || newFile.isBinary
  })
}
