<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import type { Comment, DiffHunk, DiffLineType } from '@/api/types'
import DiffLineRow from '@/components/DiffLineRow.vue'
import RowSegment from '@/components/RowSegment.vue'
import { groupRows, ROW_HEIGHT } from '@/utils/row-segments'
import CommentThread from './CommentThread.vue'
import { useLineDragSelect } from '@/composables/use-line-drag-select'
import type { HighlightedToken } from '@/composables/use-syntax-highlighting'
import { useCardState } from '@/composables/use-card-state'
import { useCommentActions } from '@/composables/use-comment-actions'
import {
  checkAnchor,
  createAnchor,
  type AnchorLine,
  type CommentAnchor
} from '@/utils/comment-anchor'

const props = defineProps<{
  /** File the hunk belongs to: a new comment is created for it. */
  path: string
  hunk: DiffHunk
  lineTokens?: (HighlightedToken[] | null)[] | null
  /** Active review for the current branch — enables gutter drag-select and comment threads (see ADR 0018). */
  commentable?: boolean
  comments?: Comment[]
  /** Read-only review view (ReviewDetailPage.vue) — hides every line outside a comment's own range instead of showing the full hunk. */
  commentsOnly?: boolean
  /** Whether *existing* comments show edit/delete/resolve controls — independent of `commentable` (which only gates new-comment drag-select). DiffPanel.vue passes the same value as `commentable`; ReviewDetailPage.vue sets this without `commentable`, to allow managing comments on a review that isn't itself commentable. */
  commentsEditable?: boolean
  wrap?: boolean
}>()

const actions = useCommentActions()

const header = computed(
  () =>
    `@@ -${props.hunk.oldStart},${props.hunk.oldLines} +${props.hunk.newStart},${props.hunk.newLines} @@`
)

// The anchor column for a *saved* comment is inferred from its lineType
// ('removed' -> old-side numbers, everything else -> new-side numbers) —
// see comment.repo.ts / ADR 0017. A drag started on the old-side gutter
// over purely context lines (rare — the new-side gutter works identically
// for context lines) stores old-side numbers under a non-'removed'
// lineType, which this same rule won't re-anchor to the right row on
// reload. Known, accepted MVP limitation — the comment itself is never
// lost, only its inline position.
// One unsent comment per card and view, in the card state store: it survives the card
// leaving the virtual list. The anchor keeps the text of the selected lines, so the form
// never shows next to other text after an edit (see `comment-anchor.ts`).
const pending = useCardState<
  (CommentAnchor & { lineType: DiffLineType }) | null
>('pending:diff', () => null)

function anchorLines(column: string): AnchorLine[] {
  return props.hunk.lines.map(line => ({
    key: column === 'old' ? line.oldLineNumber : line.newLineNumber,
    text: `${line.type}\u0000${line.content}`
  }))
}

const anchorState = computed(() =>
  pending.value
    ? checkAnchor(pending.value, anchorLines(pending.value.column))
    : 'absent'
)

// This hunk holds the anchored lines, but their text changed: drop the anchor. The text
// of the form stays in its own slot and comes back with the next selection in the card.
watchEffect(() => {
  if (anchorState.value === 'stale') pending.reset()
})

/** The anchor, when it points to valid lines of this hunk. */
const ownAnchor = computed(() =>
  anchorState.value === 'valid' ? pending.value : null
)

const drag = useLineDragSelect(selection => {
  const startLine = props.hunk.lines.find(line =>
    selection.column === 'old'
      ? line.oldLineNumber === selection.startKey
      : line.newLineNumber === selection.startKey
  )
  pending.value = {
    ...createAnchor(
      selection.column,
      selection.startKey,
      selection.endKey,
      anchorLines(selection.column)
    ),
    lineType: startLine?.type ?? 'context'
  }
})

function handleMousedown(column: 'old' | 'new', key: number | null) {
  if (!props.commentable || key === null) return
  drag.start(column, key)
}

function handleMouseenter(column: 'old' | 'new', key: number | null) {
  if (!props.commentable || key === null) return
  drag.enter(column, key)
}

function isSelected(column: 'old' | 'new', key: number | null): boolean {
  if (!props.commentable || key === null) return false
  if (
    ownAnchor.value &&
    ownAnchor.value.column === column &&
    key >= ownAnchor.value.startKey &&
    key <= ownAnchor.value.endKey
  ) {
    return true
  }
  return drag.isSelected(column, key)
}

function anchorColumn(comment: Comment): 'old' | 'new' {
  return comment.lineType === 'removed' ? 'old' : 'new'
}

function isWithinAnyComment(line: {
  oldLineNumber: number | null
  newLineNumber: number | null
}): boolean {
  return (props.comments ?? []).some(comment => {
    if (comment.lineNumber === null || comment.lineNumberEnd === null) {
      return false
    }
    const key =
      anchorColumn(comment) === 'old' ? line.oldLineNumber : line.newLineNumber
    return (
      key !== null && key >= comment.lineNumber && key <= comment.lineNumberEnd
    )
  })
}

// Keep token indices tied to the original hunk when commentsOnly hides rows.
const visibleLines = computed(() => {
  const oldThreads = new Map<number, Comment[]>()
  const newThreads = new Map<number, Comment[]>()
  for (const comment of props.comments ?? []) {
    if (comment.lineNumberEnd === null) continue
    const threads = anchorColumn(comment) === 'old' ? oldThreads : newThreads
    const thread = threads.get(comment.lineNumberEnd)
    if (thread) {
      thread.push(comment)
    } else {
      threads.set(comment.lineNumberEnd, [comment])
    }
  }
  return props.hunk.lines
    .map((line, index) => ({
      line,
      index,
      comments: [
        ...(line.oldLineNumber === null
          ? []
          : (oldThreads.get(line.oldLineNumber) ?? [])),
        ...(line.newLineNumber === null
          ? []
          : (newThreads.get(line.newLineNumber) ?? []))
      ]
    }))
    .filter(entry => !props.commentsOnly || isWithinAnyComment(entry.line))
})
const grouping = computed(() => groupRows(visibleLines.value))
const pendingLineRange = computed(() =>
  ownAnchor.value
    ? { start: ownAnchor.value.startKey, end: ownAnchor.value.endKey }
    : null
)

function isPendingFormRow(column: 'old' | 'new', key: number | null): boolean {
  return (
    !!ownAnchor.value &&
    ownAnchor.value.column === column &&
    key === ownAnchor.value.endKey
  )
}

function showNewForm(line: {
  oldLineNumber: number | null
  newLineNumber: number | null
}): boolean {
  return (
    isPendingFormRow('old', line.oldLineNumber) ||
    isPendingFormRow('new', line.newLineNumber)
  )
}

// The form clears its own text after success; the anchor goes only then too, so a
// failed send keeps the form where it was.
async function submitNewComment(content: string) {
  const anchor = ownAnchor.value
  if (!anchor) return
  await actions.create({
    filePath: props.path,
    lineNumber: anchor.startKey,
    lineNumberEnd: anchor.endKey,
    lineType: anchor.lineType,
    content
  })
  pending.reset()
}

function cancelNewComment() {
  pending.reset()
}
</script>

<template>
  <div v-if="!commentsOnly || visibleLines.length > 0" class="diff-hunk">
    <div class="diff-hunk__header text-mono text-primary">{{ header }}</div>
    <component
      :is="grouping.segmented ? RowSegment : 'div'"
      v-for="group in grouping.groups"
      :key="group.start"
      v-bind="
        grouping.segmented
          ? {
              minHeight: group.rows.length * ROW_HEIGHT,
              keep: group.rows.some(({ line }) => showNewForm(line))
            }
          : {}
      "
    >
      <template v-for="{ line, index, comments } in group.rows" :key="index">
        <DiffLineRow
          :line="line"
          :tokens="lineTokens?.[index]"
          :selectable="commentable"
          :wrap="wrap"
          :old-selected="isSelected('old', line.oldLineNumber)"
          :new-selected="isSelected('new', line.newLineNumber)"
          @old-mousedown="handleMousedown('old', line.oldLineNumber)"
          @old-mouseenter="handleMouseenter('old', line.oldLineNumber)"
          @new-mousedown="handleMousedown('new', line.newLineNumber)"
          @new-mouseenter="handleMouseenter('new', line.newLineNumber)"
        />
        <CommentThread
          v-if="comments.length > 0 || showNewForm(line)"
          :comments="comments"
          :readonly="!commentsEditable"
          :show-new-form="showNewForm(line)"
          :pending-line-range="pendingLineRange"
          :new-draft-key="'new:diff'"
          :submit-new="submitNewComment"
          @cancel-new="cancelNewComment"
        />
      </template>
    </component>
  </div>
</template>

<style scoped>
.diff-hunk {
  /* Two 40px gutters + the 16px +/- prefix column (see DiffLineRow.vue) —
     read by CommentThread.vue to align the thread with the code column. */
  --comment-thread-indent: 96px;
}

.diff-hunk__header {
  padding: 2px 12px;
  font-size: var(--code-font-size);
}
</style>
