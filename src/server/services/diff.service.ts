import { diffLines } from 'diff'
import type {
  DiffFile,
  DiffFileStatus,
  DiffHunk,
  DiffLine
} from '../../shared/types.ts'
import {
  assertSafeRef,
  getFileAtRef,
  listChangedPaths,
  listUntrackedPaths
} from './git.service.ts'

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

const CONTEXT_LINES = 3

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

async function buildDiffFiles(
  repoPath: string,
  diffArgs: string[],
  oldRef: string,
  newRef: string
): Promise<DiffFile[]> {
  const changes = await listChangedPaths(repoPath, diffArgs)

  return Promise.all(
    changes.map(async change => {
      const [oldFile, newFile] = await Promise.all([
        getFileAtRef(repoPath, oldRef, change.oldPath),
        getFileAtRef(repoPath, newRef, change.newPath)
      ])

      return computeFileDiff(oldFile.content, newFile.content, {
        oldPath: change.oldPath,
        newPath: change.newPath,
        status: change.status,
        isBinary: oldFile.isBinary || newFile.isBinary
      })
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
