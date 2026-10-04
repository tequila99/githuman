<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue'
import type { Comment } from '@/api/types'
import FileContentLine from './FileContentLine.vue'
import RowSegment from './RowSegment.vue'
import { groupRows, ROW_HEIGHT } from '@/utils/row-segments'
import CommentThread from './CommentThread.vue'
import { useCardState } from '@/composables/use-card-state'
import { useCommentActions } from '@/composables/use-comment-actions'
import { useLineDragSelect } from '@/composables/use-line-drag-select'
import {
  checkAnchor,
  createAnchor,
  type AnchorLine,
  type CommentAnchor
} from '@/utils/comment-anchor'
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

const actions = useCommentActions()

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
// The anchor keeps the text of the selected lines: an edit on disk must not move the
// form next to other text (see `comment-anchor.ts`).
const pending = useCardState<CommentAnchor | null>('pending:full', () => null)

function anchorLines(): AnchorLine[] {
  return props.lines.map((text, index) => ({ key: index + 1, text }))
}

const anchorState = computed(() =>
  pending.value ? checkAnchor(pending.value, anchorLines()) : 'absent'
)

// The text of the form stays in its own slot and comes back with the next selection.
watchEffect(() => {
  if (anchorState.value === 'stale') pending.reset()
})

const ownAnchor = computed(() =>
  anchorState.value === 'valid' ? pending.value : null
)

const drag = useLineDragSelect(selection => {
  pending.value = createAnchor(
    selection.column,
    selection.startKey,
    selection.endKey,
    anchorLines()
  )
})

function isSelected(lineNumber: number): boolean {
  if (!props.commentable) return false
  if (
    ownAnchor.value &&
    lineNumber >= ownAnchor.value.startKey &&
    lineNumber <= ownAnchor.value.endKey
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
const grouping = computed(() => groupRows(rows.value))
const pendingLineRange = computed(() =>
  ownAnchor.value
    ? { start: ownAnchor.value.startKey, end: ownAnchor.value.endKey }
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

// The anchor goes only after success: a failed send keeps the form where it was.
async function submitNewComment(content: string) {
  const anchor = ownAnchor.value
  if (!anchor) return
  // `lineType: null` marks a full-file comment (ADR 0017).
  await actions.create({
    filePath: props.path,
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
</script>

<template>
  <div class="file-content-view">
    <component
      :is="grouping.segmented ? RowSegment : 'div'"
      v-for="group in grouping.groups"
      :key="group.start"
      v-bind="
        grouping.segmented
          ? {
              minHeight: group.rows.length * ROW_HEIGHT,
              keep: group.rows.some(row => ownAnchor?.endKey === row.lineNumber)
            }
          : {}
      "
    >
      <template
        v-for="{ line, index, lineNumber, comments } in group.rows"
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
          v-if="comments.length > 0 || ownAnchor?.endKey === lineNumber"
          :comments="comments"
          :readonly="!commentsEditable"
          :show-new-form="ownAnchor?.endKey === lineNumber"
          :pending-line-range="pendingLineRange"
          new-draft-key="new:full"
          :submit-new="submitNewComment"
          @cancel-new="cancelNewComment"
        />
      </template>
    </component>
  </div>
</template>

<style scoped>
.file-content-view {
  /* The single 48px gutter (see FileContentLine.vue) — read by
     CommentThread.vue to align the thread with the code column. */
  --comment-thread-indent: 48px;
}
</style>
