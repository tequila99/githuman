import { toValue, type MaybeRefOrGetter } from 'vue'
import { useAnchoredCommentSelection } from '@/composables/use-anchored-comment-selection'
import { usePendingFullComment } from '@/composables/use-pending-full-comment'
import { useCommentActions } from '@/composables/use-comment-actions'
import { checkAnchor, fullAnchorLines } from '@/utils/comment-anchor'
import { useTouchSelectionOwner } from '@/composables/use-touch-comment-selection'

export function useFullFileComment(options: {
  path: MaybeRefOrGetter<string>
  lines: MaybeRefOrGetter<string[]>
  commentable: MaybeRefOrGetter<boolean | undefined>
}) {
  const pending = usePendingFullComment()
  const actions = useCommentActions()
  const selection = useAnchoredCommentSelection({
    path: options.path,
    commentable: options.commentable,
    pending,
    mode: 'full',
    lines: () => fullAnchorLines(toValue(options.lines)),
    commit: anchor => {
      pending.value = anchor
    }
  })
  async function submitNewComment(content: string) {
    const anchor = selection.ownAnchor.value
    if (!anchor) return
    await actions.create({
      filePath: toValue(options.path),
      lineType: null,
      lineNumber: anchor.startKey,
      lineNumberEnd: anchor.endKey,
      content
    })
    pending.reset()
  }
  function cancelNewComment() {
    pending.reset()
  }
  return { ...selection, submitNewComment, cancelNewComment }
}

/** The full view owns the touch range of its card in the full mode. */
export function useFullFileTouchOwner(options: {
  lines: MaybeRefOrGetter<readonly string[]>
  /** False during a refetch: the old lines stay on screen until the new ones come. */
  fresh: MaybeRefOrGetter<boolean>
  rejected: () => void
}) {
  const pending = usePendingFullComment()
  useTouchSelectionOwner({
    mode: 'full',
    fresh: options.fresh,
    valid: anchor =>
      checkAnchor(anchor, fullAnchorLines(toValue(options.lines))) === 'valid',
    commit: selection => {
      pending.value = selection.anchor
    },
    rejected: options.rejected
  })
}
