<script setup lang="ts">
import { computed, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Comment } from '@/api/types'
import { useFileContent } from '@/composables/use-file-content'
import {
  useFullFileVersion,
  type FullFileVersion
} from '@/composables/use-full-file-version'
import { useServerEvents } from '@/composables/use-server-events'
import { useDiffStore } from '@/stores/diff-store'
import { pathOf } from '@/utils/diff-file'
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
  (e: 'content-version', version: FullFileVersion): void
}>()

const { t } = useI18n()
// The cache shows the lines at once when the virtual list mounts the card again.
const { lines, isBinary, loading, loaded, error, fetchContent } =
  useFileContent({
    cache: true
  })

// Always the file on disk, even on the Staged tab: full-file comments are
// numbered against one version everywhere, the markdown export included (#39).
watch(
  () => props.path,
  path => {
    void fetchContent(path, 'WORKTREE')
  },
  { immediate: true }
)

// On the Staged tab an unstaged edit leaves the diff (and so this view) as is,
// yet changes the lines comments here are numbered against.
const events = useServerEvents(['files:changed'], () => {
  void fetchContent(props.path, 'WORKTREE')
})
onUnmounted(() => events.close())

// The API reads a missing file as empty, so tell it apart via the unstaged diff.
const diffStore = useDiffStore()
const deletedOnDisk = computed(() =>
  diffStore.unstagedFiles.some(
    f => f.status === 'deleted' && pathOf(f) === props.path
  )
)
const version = useFullFileVersion({
  lines,
  isBinary,
  loaded,
  error,
  deleted: deletedOnDisk
})
watch(
  version,
  value => {
    if (value) emit('content-version', value)
  },
  { immediate: true }
)
</script>

<template>
  <!-- Spinner on first load only: a refetch keeps the lines on screen. -->
  <div
    v-if="loading && lines.length === 0 && !error"
    class="row justify-center q-pa-lg"
  >
    <q-spinner color="primary" size="2em" />
  </div>
  <p
    v-else-if="deletedOnDisk"
    class="text-caption text-grey-6 q-pa-md q-mb-none"
  >
    {{ t('changes.fullFileDeleted') }}
  </p>
  <div v-else-if="error" class="text-caption text-grey-6 q-pa-md">
    {{ t('changes.fullFileLoadError') }}
    <div>{{ error }}</div>
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
  />
</template>
