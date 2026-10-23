import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { Comment, DiffHunk, DiffLine } from '@/api/types'
import {
  commentColumn,
  diffCommentThreads,
  commentsForDiffLine
} from '@/utils/comment-threads'
import { diffAnchorEndsAt, type CommentAnchor } from '@/utils/comment-anchor'
import { useCommentRowSegments } from '@/composables/use-comment-row-segments'
import { useRowHeight } from '@/composables/use-row-height'

export function useDiffHunkRows(options: {
  hunk: MaybeRefOrGetter<DiffHunk>
  comments: MaybeRefOrGetter<Comment[] | undefined>
  commentsOnly: MaybeRefOrGetter<boolean | undefined>
  commentsEditable: MaybeRefOrGetter<boolean | undefined>
  wrap: MaybeRefOrGetter<boolean | undefined>
  anchor: MaybeRefOrGetter<CommentAnchor | null>
  commentable?: MaybeRefOrGetter<boolean | undefined>
}) {
  const height = useRowHeight(() => toValue(options.commentable))
  const visibleLines = computed(() => {
    const comments = toValue(options.comments) ?? []
    const threads = diffCommentThreads(comments)
    function isWithinAnyComment(line: DiffLine) {
      return comments.some(comment => {
        if (comment.lineNumber === null || comment.lineNumberEnd === null) {
          return false
        }
        const key =
          commentColumn(comment) === 'old'
            ? line.oldLineNumber
            : line.newLineNumber
        return (
          key !== null &&
          key >= comment.lineNumber &&
          key <= comment.lineNumberEnd
        )
      })
    }
    // Filter after assigning indices so tokens still address the original hunk.
    return toValue(options.hunk)
      .lines.map((line, index) => ({
        line,
        index,
        comments: commentsForDiffLine(line, threads)
      }))
      .filter(
        entry =>
          !toValue(options.commentsOnly) || isWithinAnyComment(entry.line)
      )
  })
  const { grouping, segments } = useCommentRowSegments({
    rows: visibleLines,
    rowHeight: height,
    owner: options.hunk,
    wrap: options.wrap,
    commentsEditable: options.commentsEditable,
    // Changes queues every hunk; review excerpts retain the file-view threshold.
    threshold: () => (toValue(options.commentsOnly) ? undefined : 0),
    hasForm: row => diffAnchorEndsAt(toValue(options.anchor), row.line)
  })
  return { visibleLines, grouping, segments }
}
