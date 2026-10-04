<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Comment } from '@/api/types'
import CommentItem from './CommentItem.vue'
import CommentForm from './CommentForm.vue'

withDefaults(
  defineProps<{
    comments: Comment[]
    /** Shows the "new comment" form below existing threads when true. */
    showNewForm: boolean
    /** Hides the new-comment form and edit/delete/resolve controls — used outside an active review (see ADR 0018). */
    readonly?: boolean
    /** Line(s) the pending comment is anchored to — forwarded to CommentForm's footer. */
    pendingLineRange?: { start: number; end: number } | null
    /** Slot for the unsent text of the new-comment form in the card state store — see CommentForm. */
    newDraftKey?: string | undefined
    /** Sends a new comment; resolves on success — see CommentForm. */
    submitNew?: (content: string) => Promise<void>
  }>(),
  {
    pendingLineRange: null,
    submitNew: async () => {
      throw new Error('No submit handler')
    }
  }
)

const emit = defineEmits<{
  (e: 'cancel-new'): void
}>()

const { t } = useI18n()
</script>

<template>
  <div class="comment-thread q-pa-sm q-gutter-y-sm">
    <CommentItem
      v-for="comment in comments"
      :key="comment.id"
      :comment="comment"
      :readonly="readonly"
    />
    <CommentForm
      v-if="showNewForm && !readonly"
      :submit-label="t('reviews.comments.submit')"
      :line-range="pendingLineRange"
      :draft-key="newDraftKey"
      :send="submitNew"
      @cancel="emit('cancel-new')"
    />
  </div>
</template>

<style scoped>
.comment-thread {
  background: color-mix(in srgb, var(--q-primary) 4%, transparent);
  border-top: 1px solid rgba(128, 128, 128, 0.2);
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
  margin-left: var(--comment-thread-indent, 0);
  /* Stays in view while long lines scroll horizontally (#38). 100cqi needs
     HorizontalScrollBody's query container: outside it, it's the window —
     hence the max-width cap to the parent. */
  position: sticky;
  left: var(--comment-thread-indent, 0);
  width: calc(100cqi - var(--comment-thread-indent, 0));
  max-width: calc(100% - var(--comment-thread-indent, 0));
}
</style>
