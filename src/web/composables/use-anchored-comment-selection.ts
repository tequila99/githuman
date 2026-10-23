import {
  computed,
  inject,
  toValue,
  watchEffect,
  type MaybeRefOrGetter
} from 'vue'
import type { DiffLineType } from '@/api/types'
import { CARD_STATE_KEY, type CardState } from '@/composables/use-card-state'
import { useLineDragSelect } from '@/composables/use-line-drag-select'
import { useTouchCommentSelection } from '@/composables/use-touch-comment-selection'
import {
  checkAnchor,
  createAnchor,
  type AnchorLine,
  type CommentAnchor
} from '@/utils/comment-anchor'

export function useAnchoredCommentSelection<T extends CommentAnchor>(options: {
  path: MaybeRefOrGetter<string>
  commentable: MaybeRefOrGetter<boolean | undefined>
  pending: CardState<T | null>
  /** `diff` for a hunk, `full` for a full file: one card has one touch range for each. */
  mode: 'diff' | 'full'
  lines: (column: string) => AnchorLine[]
  lineTypeAt?: (column: string, key: number) => DiffLineType | null
  commit: (anchor: CommentAnchor) => void
}) {
  const { pending, lines, commit } = options
  const touch = useTouchCommentSelection()
  // Touch ranges live in the card state store, so they need the key of the card.
  const cardKey = inject(CARD_STATE_KEY, undefined)

  function handleTap(column: string, key: number | null) {
    if (!toValue(options.commentable) || key === null) return
    if (!touch || cardKey === undefined) return
    touch.tap(cardKey, {
      path: toValue(options.path),
      mode: options.mode,
      column,
      key,
      lines: lines(column),
      lineTypeAt: line => options.lineTypeAt?.(column, line) ?? null
    })
  }
  // The touch range of this card, when its lines are in these rows. Another hunk leaves it as is.
  const touchAnchor = computed(() => {
    const selected = touch?.selection.value
    if (
      !selected ||
      !toValue(options.commentable) ||
      selected.cardKey !== cardKey ||
      selected.mode !== options.mode
    ) {
      return null
    }
    return checkAnchor(selected.anchor, lines(selected.anchor.column)) ===
      'valid'
      ? selected.anchor
      : null
  })

  const anchorState = computed(() =>
    pending.value
      ? checkAnchor(pending.value, lines(pending.value.column))
      : 'absent'
  )
  // Another hunk's anchor is absent here; only changed text invalidates this anchor.
  watchEffect(() => {
    if (anchorState.value === 'stale') pending.reset()
  })
  const ownAnchor = computed(() =>
    anchorState.value === 'valid' ? pending.value : null
  )
  const drag = useLineDragSelect(selection => {
    commit(
      createAnchor(
        selection.column,
        selection.startKey,
        selection.endKey,
        lines(selection.column)
      )
    )
  })

  function handleMousedown(column: string, key: number | null) {
    if (!toValue(options.commentable) || key === null) return
    touch?.cancel()
    drag.start(column, key)
  }
  function handleMouseenter(column: string, key: number | null) {
    if (!toValue(options.commentable) || key === null) return
    drag.enter(column, key)
  }
  function isSelected(column: string, key: number | null): boolean {
    const selected = touchAnchor.value
    if (
      selected?.column === column &&
      key !== null &&
      key >= selected.startKey &&
      key <= selected.endKey
    ) {
      return true
    }
    if (!toValue(options.commentable) || key === null) return false
    const anchor = ownAnchor.value
    if (
      anchor &&
      anchor.column === column &&
      key >= anchor.startKey &&
      key <= anchor.endKey
    ) {
      return true
    }
    return drag.isSelected(column, key)
  }
  const pendingLineRange = computed(() =>
    ownAnchor.value
      ? { start: ownAnchor.value.startKey, end: ownAnchor.value.endKey }
      : null
  )

  return {
    ownAnchor,
    pendingLineRange,
    handleTap,
    handleMousedown,
    handleMouseenter,
    isSelected
  }
}
