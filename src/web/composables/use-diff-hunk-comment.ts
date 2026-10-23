import { toValue, type MaybeRefOrGetter } from 'vue'
import type { DiffHunk } from '@/api/types'
import { useTouchSelectionOwner } from '@/composables/use-touch-comment-selection'
import { useAnchoredCommentSelection } from '@/composables/use-anchored-comment-selection'
import { usePendingDiffComment } from '@/composables/use-pending-diff-comment'
import { useCommentActions } from '@/composables/use-comment-actions'
import {
  checkAnchor,
  diffAnchorEndsAt,
  diffAnchorLines
} from '@/utils/comment-anchor'

export function useDiffHunkComment(options: {
  path: MaybeRefOrGetter<string>
  hunk: MaybeRefOrGetter<DiffHunk>
  commentable: MaybeRefOrGetter<boolean | undefined>
}) {
  const pending = usePendingDiffComment()
  const actions = useCommentActions()
  // A saved diff comment takes the type of its first line (ADR 0017).
  function lineTypeAt(column: string, key: number) {
    return (
      toValue(options.hunk).lines.find(
        line =>
          (column === 'old' ? line.oldLineNumber : line.newLineNumber) === key
      )?.type ?? null
    )
  }
  const selection = useAnchoredCommentSelection({
    path: options.path,
    commentable: options.commentable,
    pending,
    mode: 'diff',
    lines: column => diffAnchorLines(toValue(options.hunk).lines, column),
    lineTypeAt,
    commit: anchor => {
      pending.value = {
        ...anchor,
        lineType: lineTypeAt(anchor.column, anchor.startKey) ?? 'context'
      }
    }
  })
  function showNewForm(line: {
    oldLineNumber: number | null
    newLineNumber: number | null
  }) {
    return diffAnchorEndsAt(selection.ownAnchor.value, line)
  }
  async function submitNewComment(content: string) {
    const anchor = selection.ownAnchor.value
    if (!anchor) return
    await actions.create({
      filePath: toValue(options.path),
      lineNumber: anchor.startKey,
      lineNumberEnd: anchor.endKey,
      lineType: anchor.lineType,
      content
    })
    // Failed sends retain the anchor and the form's draft in the card state.
    pending.reset()
  }
  function cancelNewComment() {
    pending.reset()
  }
  return { ...selection, showNewForm, submitNewComment, cancelNewComment }
}

/**
 * The diff body owns the touch range of its card. It checks the range against all hunks:
 * one hunk cannot tell a moved range from a deleted one.
 */
export function useDiffFileTouchOwner(options: {
  hunks: MaybeRefOrGetter<readonly DiffHunk[]>
  fresh: MaybeRefOrGetter<boolean>
  rejected: () => void
}) {
  const pending = usePendingDiffComment()
  useTouchSelectionOwner({
    mode: 'diff',
    fresh: options.fresh,
    valid: anchor =>
      toValue(options.hunks).some(
        hunk =>
          checkAnchor(anchor, diffAnchorLines(hunk.lines, anchor.column)) ===
          'valid'
      ),
    commit: selection => {
      pending.value = {
        ...selection.anchor,
        lineType: selection.lineType ?? 'context'
      }
    },
    rejected: options.rejected
  })
}
