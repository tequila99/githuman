<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Comment, DiffHunk, DiffLineType } from '@/api/types'
import DiffLineRow from '@/components/DiffLineRow.vue'
import CommentThread from './CommentThread.vue'
import {
  useLineDragSelect,
  type DragSelection
} from '@/composables/use-line-drag-select'
import type { HighlightedToken } from '@/composables/use-syntax-highlighting'

const props = defineProps<{
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

const emit = defineEmits<{
  (
    e: 'create-comment',
    input: {
      lineNumber: number
      lineNumberEnd: number
      lineType: DiffLineType
      content: string
    }
  ): void
  (e: 'edit-comment', id: string, content: string): void
  (e: 'delete-comment', id: string): void
  (e: 'resolve-comment', id: string): void
  (e: 'unresolve-comment', id: string): void
}>()

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
const pending = ref<DragSelection | null>(null)
const pendingLineType = ref<DiffLineType>('context')

const drag = useLineDragSelect(selection => {
  pending.value = selection
  const startLine = props.hunk.lines.find(line =>
    selection.column === 'old'
      ? line.oldLineNumber === selection.startKey
      : line.newLineNumber === selection.startKey
  )
  pendingLineType.value = startLine?.type ?? 'context'
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
    pending.value &&
    pending.value.column === column &&
    key >= pending.value.startKey &&
    key <= pending.value.endKey
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
const pendingLineRange = computed(() =>
  pending.value
    ? { start: pending.value.startKey, end: pending.value.endKey }
    : null
)

function isPendingFormRow(column: 'old' | 'new', key: number | null): boolean {
  return (
    !!pending.value &&
    pending.value.column === column &&
    key === pending.value.endKey
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

function submitNewComment(content: string) {
  if (!pending.value) return
  emit('create-comment', {
    lineNumber: pending.value.startKey,
    lineNumberEnd: pending.value.endKey,
    lineType: pendingLineType.value,
    content
  })
  pending.value = null
}

function cancelNewComment() {
  pending.value = null
}
</script>

<template>
  <div v-if="!commentsOnly || visibleLines.length > 0" class="diff-hunk">
    <div class="diff-hunk__header text-mono text-primary">{{ header }}</div>
    <template v-for="{ line, index, comments } in visibleLines" :key="index">
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
        @submit-new="submitNewComment"
        @cancel-new="cancelNewComment"
        @edit="(id, content) => emit('edit-comment', id, content)"
        @delete="id => emit('delete-comment', id)"
        @resolve="id => emit('resolve-comment', id)"
        @unresolve="id => emit('unresolve-comment', id)"
      />
    </template>
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
