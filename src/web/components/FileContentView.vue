<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Comment } from '@/api/types'
import FileContentLine from './FileContentLine.vue'
import CommentThread from './CommentThread.vue'
import {
  useLineDragSelect,
  type DragSelection
} from '@/composables/use-line-drag-select'
import {
  highlightLines,
  type HighlightedToken
} from '@/composables/use-syntax-highlighting'

const props = defineProps<{
  path: string
  lines: string[]
  /** Active review for the current branch — enables gutter drag-select and comment threads (see ADR 0018). */
  commentable?: boolean
  comments?: Comment[]
  /** Whether *existing* comments show edit/delete/resolve controls — independent of `commentable`. See DiffHunkView.vue. */
  commentsEditable?: boolean
  wrap?: boolean
}>()

const emit = defineEmits<{
  (
    e: 'create-comment',
    input: { lineNumber: number; lineNumberEnd: number; content: string }
  ): void
  (e: 'edit-comment', id: string, content: string): void
  (e: 'delete-comment', id: string): void
  (e: 'resolve-comment', id: string): void
  (e: 'unresolve-comment', id: string): void
}>()

const highlightedLines = ref<(HighlightedToken[] | null)[] | null>(null)

// Guards against out-of-order highlight results if path/lines change again
// before the previous highlightLines() call has resolved.
let latestHighlightRequestId = 0

watch(
  () => [props.path, props.lines] as const,
  async ([path, lines]) => {
    const requestId = ++latestHighlightRequestId
    highlightedLines.value = null
    if (lines.length > 0) {
      const result = await highlightLines(path, lines)
      if (requestId === latestHighlightRequestId) {
        highlightedLines.value = result
      }
    }
  },
  { immediate: true }
)

// Full-file mode has a single gutter column, unlike the two-column diff
// gutter — the drag-select composable's "column" concept is unused here
// (always 'full'), only the range math matters (see ADR 0017 AC14).
const pending = ref<DragSelection | null>(null)

const drag = useLineDragSelect(selection => {
  pending.value = selection
})

function isSelected(lineNumber: number): boolean {
  if (!props.commentable) return false
  if (
    pending.value &&
    lineNumber >= pending.value.startKey &&
    lineNumber <= pending.value.endKey
  ) {
    return true
  }
  return drag.isSelected('full', lineNumber)
}

const rows = computed(() => {
  const byLine = new Map<number, Comment[]>()
  for (const comment of props.comments ?? []) {
    if (comment.lineNumberEnd === null) continue
    const thread = byLine.get(comment.lineNumberEnd)
    if (thread) {
      thread.push(comment)
    } else {
      byLine.set(comment.lineNumberEnd, [comment])
    }
  }
  return props.lines.map((line, index) => ({
    line,
    index,
    lineNumber: index + 1,
    comments: byLine.get(index + 1) ?? []
  }))
})
const pendingLineRange = computed(() =>
  pending.value
    ? { start: pending.value.startKey, end: pending.value.endKey }
    : null
)

function handleGutterMousedown(lineNumber: number) {
  if (!props.commentable) return
  drag.start('full', lineNumber)
}

function handleGutterMouseenter(lineNumber: number) {
  if (!props.commentable) return
  drag.enter('full', lineNumber)
}

function submitNewComment(content: string) {
  if (!pending.value) return
  emit('create-comment', {
    lineNumber: pending.value.startKey,
    lineNumberEnd: pending.value.endKey,
    content
  })
  pending.value = null
}

function cancelNewComment() {
  pending.value = null
}
</script>

<template>
  <div class="file-content-view">
    <template
      v-for="{ line, index, lineNumber, comments } in rows"
      :key="index"
    >
      <FileContentLine
        :line-number="lineNumber"
        :content="line"
        :tokens="highlightedLines?.[index]"
        :selectable="commentable"
        :selected="isSelected(lineNumber)"
        :wrap="wrap"
        @gutter-mousedown="handleGutterMousedown(lineNumber)"
        @gutter-mouseenter="handleGutterMouseenter(lineNumber)"
      />
      <CommentThread
        v-if="comments.length > 0 || pending?.endKey === lineNumber"
        :comments="comments"
        :readonly="!commentsEditable"
        :show-new-form="pending?.endKey === lineNumber"
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
.file-content-view {
  /* The single 48px gutter (see FileContentLine.vue) — read by
     CommentThread.vue to align the thread with the code column. */
  --comment-thread-indent: 48px;
}
</style>
