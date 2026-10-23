<script setup lang="ts">
import { computed } from 'vue'
import type { Comment, DiffHunk } from '@/api/types'
import DiffLineRow from '@/components/DiffLineRow.vue'
import RowSegment from '@/components/RowSegment.vue'
import CommentThread from './CommentThread.vue'
import type { TokensByLine } from '@/composables/use-syntax-highlighting'
import { useDiffHunkComment } from '@/composables/use-diff-hunk-comment'
import { useDiffHunkRows } from '@/composables/use-diff-hunk-rows'

const props = defineProps<{
  /** File the hunk belongs to: a new comment is created for it. */
  path: string
  hunk: DiffHunk
  lineTokens?: TokensByLine | null
  /** Active review for the current branch — enables gutter drag-select and comment threads (see ADR 0018). */
  commentable?: boolean
  comments?: Comment[]
  /** Read-only review view (ReviewDetailPage.vue) — hides every line outside a comment's own range instead of showing the full hunk. */
  commentsOnly?: boolean
  /** Whether *existing* comments show edit/delete/resolve controls — independent of `commentable` (which only gates new-comment drag-select). DiffPanel.vue passes the same value as `commentable`; ReviewDetailPage.vue sets this without `commentable`, to allow managing comments on a review that isn't itself commentable. */
  commentsEditable?: boolean
  wrap?: boolean
}>()

const header = computed(
  () =>
    `@@ -${props.hunk.oldStart},${props.hunk.oldLines} +${props.hunk.newStart},${props.hunk.newLines} @@`
)

const {
  ownAnchor,
  pendingLineRange,
  handleTap,
  handleMousedown,
  handleMouseenter,
  isSelected,
  showNewForm,
  submitNewComment,
  cancelNewComment
} = useDiffHunkComment({
  path: () => props.path,
  hunk: () => props.hunk,
  commentable: () => props.commentable
})
const { visibleLines, grouping, segments } = useDiffHunkRows({
  hunk: () => props.hunk,
  comments: () => props.comments,
  commentsOnly: () => props.commentsOnly,
  commentsEditable: () => props.commentsEditable,
  commentable: () => props.commentable,
  wrap: () => props.wrap,
  anchor: ownAnchor
})
</script>

<template>
  <div v-if="!commentsOnly || visibleLines.length > 0" class="diff-hunk">
    <div class="diff-hunk__header text-mono text-primary">{{ header }}</div>
    <component
      :is="grouping.segmented ? RowSegment : 'div'"
      v-for="group in segments"
      :key="group.start"
      v-bind="grouping.segmented ? group.props : {}"
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
          @old-tap="handleTap('old', line.oldLineNumber)"
          @new-tap="handleTap('new', line.newLineNumber)"
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
  line-height: 21px;
  white-space: nowrap;
}
</style>
