<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Comment } from '@/api/types'
import { useFileContent } from '@/composables/use-file-content'
import FileContentView from './FileContentView.vue'
import type { DiffSource } from '@/stores/diff-store'

const props = withDefaults(
  defineProps<{
    path: string
    source: DiffSource
    /**
     * Overrides the source-derived ref. Used by ReviewDetailPage.vue, whose
     * full-file mode is a deliberate exception to "review = frozen snapshot"
     * (ADR 0003/0017) — it always reads the *current* disk content
     * (WORKTREE) regardless of which source the review's diff snapshot was
     * taken from.
     */
    targetRef: 'INDEX' | 'WORKTREE' | undefined
    commentable?: boolean
    comments?: Comment[]
    /** Whether existing comments show edit/delete/resolve controls — see DiffHunkView.vue. */
    commentsEditable?: boolean
  }>(),
  { commentable: false, comments: () => [] }
)

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

const { t } = useI18n()
const { lines, isBinary, loading, fetchContent } = useFileContent()

const resolvedTargetRef = computed(
  () => props.targetRef ?? (props.source === 'staged' ? 'INDEX' : 'WORKTREE')
)

watch(
  () => [props.path, resolvedTargetRef.value] as const,
  ([path, ref]) => {
    void fetchContent(path, ref)
  },
  { immediate: true }
)
</script>

<template>
  <div v-if="loading" class="row justify-center q-pa-lg">
    <q-spinner color="primary" size="2em" />
  </div>
  <p v-else-if="isBinary" class="text-caption text-grey-6 q-pa-md q-mb-none">
    {{ t('changes.binaryFile') }}
  </p>
  <FileContentView
    v-else
    :path="path"
    :lines="lines"
    :commentable="commentable"
    :comments-editable="commentsEditable"
    :comments="comments"
    @create-comment="input => emit('create-comment', input)"
    @edit-comment="(id, content) => emit('edit-comment', id, content)"
    @delete-comment="id => emit('delete-comment', id)"
    @resolve-comment="id => emit('resolve-comment', id)"
    @unresolve-comment="id => emit('unresolve-comment', id)"
  />
</template>
