<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  Comment,
  DiffFile,
  DiffFileStatus,
  DiffLineType
} from '@/api/types'
import type { DiffSource } from '@/stores/diff-store'
import DiffHunkView from '@/components/DiffHunkView.vue'
import DiffFileFullView from '@/components/DiffFileFullView.vue'
import FileCardFrame from '@/components/FileCardFrame.vue'
import FileCardHeader from '@/components/FileCardHeader.vue'
import FileHeaderMenu from '@/components/FileHeaderMenu.vue'
import CommentCountBadge from '@/components/CommentCountBadge.vue'
import {
  highlightFile,
  type HighlightedToken
} from '@/composables/use-syntax-highlighting'
import { pathOf } from '@/utils/diff-file'
import { isMarkdown } from '@/utils/file-wrap'

const props = withDefaults(
  defineProps<{
    file: DiffFile
    source: DiffSource
    expanded: boolean
    /**
     * Overrides the source-derived full-file ref. Set by ReviewDetailPage.vue
     * (always 'WORKTREE' — see DiffFileFullView.vue for why); omitted on the
     * Changes page, where `source` alone decides it.
     */
    targetRef?: 'INDEX' | 'WORKTREE'
    /** Active review for the current branch — enables gutter drag-select and comment threads (see ADR 0018). */
    commentable?: boolean
    comments?: Comment[]
    /** Read-only review view (ReviewDetailPage.vue) — diff hunks show only commented lines instead of the full file diff. */
    commentsOnly?: boolean
    /** Whether existing comments show edit/delete/resolve controls — see DiffHunkView.vue. */
    commentsEditable?: boolean
    /** Hides the "show full file" toggle (e.g. in review views where only the diff makes sense). */
    noFullFile?: boolean
  }>(),
  { commentable: false, comments: () => [], noFullFile: false }
)

const emit = defineEmits<{
  (e: 'toggle'): void
  (e: 'expand'): void
  (
    e: 'create-comment',
    input: {
      filePath: string
      lineNumber: number
      lineNumberEnd: number
      lineType: DiffLineType | null
      content: string
    }
  ): void
  (e: 'edit-comment', id: string, content: string): void
  (e: 'delete-comment', id: string): void
  (e: 'resolve-comment', id: string): void
  (e: 'unresolve-comment', id: string): void
}>()

const { t } = useI18n()

const STATUS_COLOR: Record<DiffFileStatus, string> = {
  added: 'positive',
  modified: 'warning',
  deleted: 'negative',
  renamed: 'purple'
}

const path = computed(() => pathOf(props.file))

// Component instance is keyed by path (:key="pathOf(file)" in
// DiffPanel.vue), so this initializes once per file — no watcher needed.
const wrap = ref(isMarkdown(path.value))

// A file's comments span both diff-mode and full-file-mode ranges — split
// by lineType (null = full-file, see ADR 0017) so each view only sees its
// own comments; otherwise a diff comment whose lineNumberEnd happens to
// match a full-file line number (or vice versa) would bleed into the wrong
// view.
const diffComments = computed(() =>
  (props.comments ?? []).filter(c => c.lineType !== null)
)
const fullFileComments = computed(() =>
  (props.comments ?? []).filter(c => c.lineType === null)
)

const viewMode = ref<'diff' | 'full'>('diff')

const showFullFile = computed({
  get: () => viewMode.value === 'full',
  set: (value: boolean) => {
    if (value) {
      viewMode.value = 'full'
      if (!props.expanded) emit('expand')
    } else if (props.expanded) {
      viewMode.value = 'diff'
    }
  }
})

const highlightedLines = ref<(HighlightedToken[] | null)[] | null>(null)

// Guards against out-of-order highlight results if `file` changes again
// before the previous highlightFile() call has resolved.
let latestHighlightRequestId = 0

watch(
  () => props.file,
  async file => {
    const requestId = ++latestHighlightRequestId
    viewMode.value = 'diff'
    highlightedLines.value = null
    const result = await highlightFile(file)
    if (requestId === latestHighlightRequestId) {
      highlightedLines.value = result
    }
  },
  { immediate: true }
)

function tokensForHunk(
  hunkIndex: number
): (HighlightedToken[] | null)[] | null {
  if (!highlightedLines.value) return null
  const offset = props.file.hunks
    .slice(0, hunkIndex)
    .reduce((sum, hunk) => sum + hunk.lines.length, 0)
  return highlightedLines.value.slice(
    offset,
    offset + props.file.hunks[hunkIndex]!.lines.length
  )
}

function createDiffComment(input: {
  lineNumber: number
  lineNumberEnd: number
  lineType: DiffLineType
  content: string
}) {
  emit('create-comment', { filePath: path.value, ...input })
}

function createFullFileComment(input: {
  lineNumber: number
  lineNumberEnd: number
  content: string
}) {
  emit('create-comment', { filePath: path.value, lineType: null, ...input })
}
</script>

<template>
  <FileCardFrame :id="`diff-file-${path}`" class="diff-file-card">
    <template #header>
      <q-item
        v-ripple
        clickable
        dense
        class="diff-file-card__header-item"
        @click="emit('toggle')"
      >
        <FileCardHeader :path="path">
          <template #leading>
            <q-icon
              name="chevron_right"
              size="xs"
              class="diff-file-card__chevron"
              :class="{ 'diff-file-card__chevron--expanded': expanded }"
            />
          </template>

          <template #badges>
            <CommentCountBadge :count="comments.length" />
          </template>

          <div
            v-if="!noFullFile"
            class="diff-file-card__toggle-section"
            @click.stop
          >
            <q-toggle
              v-model="showFullFile"
              left-label
              dense
              size="xs"
              :label="t('changes.showFullFile')"
            />
          </div>

          <div class="diff-file-card__status-section">
            <q-badge :color="STATUS_COLOR[file.status]" outline rounded>
              {{ t(`changes.fileStatus.${file.status}`) }}
            </q-badge>
          </div>

          <span class="text-caption diff-file-card__stats">
            <span class="text-positive">+{{ file.additions }}</span>
            <span class="text-negative q-ml-xs">-{{ file.deletions }}</span>
          </span>

          <div @click.stop>
            <FileHeaderMenu v-model="wrap" />
          </div>
        </FileCardHeader>
      </q-item>
    </template>

    <div v-if="expanded" class="diff-file-card__body">
      <DiffFileFullView
        v-if="viewMode === 'full'"
        :path="path"
        :source="source"
        :target-ref="targetRef"
        :commentable="commentable"
        :comments-editable="commentsEditable"
        :comments="fullFileComments"
        :wrap="wrap"
        @create-comment="createFullFileComment"
        @edit-comment="(id, content) => emit('edit-comment', id, content)"
        @delete-comment="id => emit('delete-comment', id)"
        @resolve-comment="id => emit('resolve-comment', id)"
        @unresolve-comment="id => emit('unresolve-comment', id)"
      />
      <template v-else>
        <p
          v-if="file.isBinary"
          class="text-caption text-grey-6 q-pa-md q-mb-none"
        >
          {{ t('changes.binaryFile') }}
        </p>
        <p
          v-else-if="file.hunks.length === 0"
          class="text-caption text-grey-6 q-pa-md q-mb-none"
        >
          {{ t('changes.noTextChanges') }}
        </p>
        <DiffHunkView
          v-for="(hunk, index) in file.hunks"
          :key="index"
          :hunk="hunk"
          :line-tokens="tokensForHunk(index)"
          :commentable="commentable"
          :comments-editable="commentsEditable"
          :comments="diffComments"
          :comments-only="commentsOnly"
          :wrap="wrap"
          @create-comment="createDiffComment"
          @edit-comment="(id, content) => emit('edit-comment', id, content)"
          @delete-comment="id => emit('delete-comment', id)"
          @resolve-comment="id => emit('resolve-comment', id)"
          @unresolve-comment="id => emit('unresolve-comment', id)"
        />
      </template>
    </div>
  </FileCardFrame>
</template>

<style scoped>
.diff-file-card {
  margin-bottom: 8px;
}

.diff-file-card__header-item {
  padding: 0;
  min-height: 0;
}

.diff-file-card__chevron {
  transition: transform 0.15s ease;
}

.diff-file-card__chevron--expanded {
  transform: rotate(90deg);
}

.diff-file-card__toggle-section {
  display: flex;
  justify-content: flex-end;
  min-width: 160px;
}

.diff-file-card__status-section {
  display: flex;
  justify-content: flex-end;
  min-width: 92px;
}

.diff-file-card__stats {
  min-width: 76px;
  display: inline-block;
  text-align: right;
}

.diff-file-card__body {
  /* overflow-y must be set explicitly alongside overflow-x here (not left
     at its 'visible' default) — otherwise the UA auto-coerces it to 'auto'
     too (CSS Overflow §3), which would create an unintended second
     vertical scroll container nested inside the page's own
     <q-scroll-area>. */
  overflow-x: auto;
  overflow-y: hidden;
  border-top: 1px solid rgba(128, 128, 128, 0.2);
}
</style>
