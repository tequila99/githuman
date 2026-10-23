<script setup lang="ts">
import type { Comment } from '@/api/types'
import FileContentLine from './FileContentLine.vue'
import RowSegment from './RowSegment.vue'
import CommentThread from './CommentThread.vue'
import { useLineTokens } from '@/composables/use-line-tokens'
import { useFullFileComment } from '@/composables/use-full-file-comment'
import { useFullFileRows } from '@/composables/use-full-file-rows'

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

// Mounted only while shown: an unmount stops the tokenizing. `useFileContent` keeps the
// same array for the same text, so the array is the cache key of the tokens.
const { tokens: highlightedLines, holdForTokens } = useLineTokens(() => {
  const lines = props.lines
  if (lines.length === 0) return null
  return { key: lines, path: props.path, lines: () => lines }
}, true)

const {
  ownAnchor,
  pendingLineRange,
  handleTap,
  handleMousedown,
  handleMouseenter,
  isSelected,
  submitNewComment,
  cancelNewComment
} = useFullFileComment({
  path: () => props.path,
  lines: () => props.lines,
  commentable: () => props.commentable
})
const { grouping, segments, rowHeight } = useFullFileRows({
  lines: () => props.lines,
  comments: () => props.comments,
  commentsEditable: () => props.commentsEditable,
  commentable: () => props.commentable,
  wrap: () => props.wrap,
  anchor: ownAnchor
})
</script>

<template>
  <!-- The height of all rows, so the view does not jump when the rows come. -->
  <div
    v-if="holdForTokens"
    class="row justify-center items-start q-pa-lg"
    :style="{ minHeight: `${lines.length * rowHeight}px` }"
  >
    <q-spinner color="primary" size="2em" />
  </div>
  <div v-else class="file-content-view">
    <component
      :is="grouping.segmented ? RowSegment : 'div'"
      v-for="group in segments"
      :key="group.start"
      v-bind="grouping.segmented ? group.props : {}"
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
          :selected="isSelected('full', lineNumber)"
          :wrap="wrap"
          @gutter-mousedown="handleMousedown('full', lineNumber)"
          @gutter-mouseenter="handleMouseenter('full', lineNumber)"
          @gutter-tap="handleTap('full', lineNumber)"
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
