import type { Comment, DiffLine } from '@/api/types'

export function commentColumn(comment: Comment): 'old' | 'new' {
  return comment.lineType === 'removed' ? 'old' : 'new'
}

export function commentsByLine(
  comments: readonly Comment[]
): Map<number, Comment[]> {
  const threads = new Map<number, Comment[]>()
  for (const comment of comments) {
    if (comment.lineNumberEnd === null) continue
    const thread = threads.get(comment.lineNumberEnd)
    if (thread) {
      thread.push(comment)
    } else {
      threads.set(comment.lineNumberEnd, [comment])
    }
  }
  return threads
}

export function diffCommentThreads(comments: readonly Comment[]) {
  return {
    old: commentsByLine(
      comments.filter(comment => commentColumn(comment) === 'old')
    ),
    new: commentsByLine(
      comments.filter(comment => commentColumn(comment) === 'new')
    )
  }
}

export function commentsForDiffLine(
  line: Pick<DiffLine, 'oldLineNumber' | 'newLineNumber'>,
  threads: ReturnType<typeof diffCommentThreads>
): Comment[] {
  return [
    ...(line.oldLineNumber === null
      ? []
      : (threads.old.get(line.oldLineNumber) ?? [])),
    ...(line.newLineNumber === null
      ? []
      : (threads.new.get(line.newLineNumber) ?? []))
  ]
}
