import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { Comment } from '@/api/types'
import { commentsByLine } from '@/utils/comment-threads'
import { anchorEndsAt, type CommentAnchor } from '@/utils/comment-anchor'
import { useCommentRowSegments } from '@/composables/use-comment-row-segments'
import { useRowHeight } from '@/composables/use-row-height'

export function useFullFileRows(options: {
  lines: MaybeRefOrGetter<string[]>
  comments: MaybeRefOrGetter<Comment[] | undefined>
  commentsEditable: MaybeRefOrGetter<boolean | undefined>
  wrap: MaybeRefOrGetter<boolean | undefined>
  anchor: MaybeRefOrGetter<CommentAnchor | null>
  commentable?: MaybeRefOrGetter<boolean | undefined>
}) {
  const height = useRowHeight(() => toValue(options.commentable))
  const rows = computed(() => {
    const byLine = commentsByLine(toValue(options.comments) ?? [])
    return toValue(options.lines).map((line, index) => ({
      line,
      index,
      lineNumber: index + 1,
      comments: byLine.get(index + 1) ?? []
    }))
  })
  const segments = useCommentRowSegments({
    rows,
    rowHeight: height,
    owner: options.lines,
    wrap: options.wrap,
    commentsEditable: options.commentsEditable,
    hasForm: row =>
      anchorEndsAt(toValue(options.anchor), 'full', row.lineNumber)
  })
  return { ...segments, rowHeight: height }
}
