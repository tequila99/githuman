<script setup lang="ts">
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Comment } from '@/api/types'
import { useFileContent } from '@/composables/use-file-content'
import FileContentView from './FileContentView.vue'

const props = withDefaults(
  defineProps<{
    path: string
    commentable?: boolean
    comments?: Comment[]
    /** Whether existing comments show edit/delete/resolve controls — see DiffHunkView.vue. */
    commentsEditable?: boolean
    wrap?: boolean
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

// Always the file on disk, even on the Staged tab: full-file comments are
// numbered against one version everywhere, the markdown export included (#39).
watch(
  () => props.path,
  path => {
    void fetchContent(path, 'WORKTREE')
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
    :wrap="wrap"
    @create-comment="input => emit('create-comment', input)"
    @edit-comment="(id, content) => emit('edit-comment', id, content)"
    @delete-comment="id => emit('delete-comment', id)"
    @resolve-comment="id => emit('resolve-comment', id)"
    @unresolve-comment="id => emit('unresolve-comment', id)"
  />
</template>
