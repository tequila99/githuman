<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Comment, DiffFile } from '@/api/types'
import type { HighlightedToken } from '@/composables/use-syntax-highlighting'
import DiffHunkView from '@/components/DiffHunkView.vue'
import DiffFileFullView from '@/components/DiffFileFullView.vue'
import HorizontalScrollBody from '@/components/HorizontalScrollBody.vue'
import LoadErrorBanner from '@/components/LoadErrorBanner.vue'

const props = withDefaults(
  defineProps<{
    /** The file with its hunks. */
    file: DiffFile
    path: string
    viewMode: 'diff' | 'full'
    wrap: boolean
    /** One token slice per hunk, or null until the tokens arrive. */
    hunkTokens: (HighlightedToken[] | null)[][] | null
    /**
     * `loading`: no hunks yet. `error`: the last request failed; `file` may still hold
     * older hunks. `ready`: `file.hunks` is the diff, and empty means no text changes.
     */
    hunksState?: 'loading' | 'error' | 'ready'
    hunksError?: string | undefined
    /** Height of the loading block in px, so the card does not jump when the hunks arrive. */
    loadingHeight?: number
    commentable?: boolean
    commentsEditable?: boolean
    /** Read-only review view: hunks show only commented lines. */
    commentsOnly?: boolean
    comments?: Comment[]
  }>(),
  {
    commentable: false,
    comments: () => [],
    hunksState: 'ready',
    hunksError: undefined,
    loadingHeight: 0
  }
)

const emit = defineEmits<{
  (e: 'retry-hunks'): void
}>()

const { t } = useI18n()

// A file's comments span both diff-mode and full-file-mode ranges — split
// by lineType (null = full-file, see ADR 0017) so each view only sees its
// own comments; otherwise a diff comment whose lineNumberEnd happens to
// match a full-file line number (or vice versa) would bleed into the wrong
// view.
const diffComments = computed(() =>
  props.comments.filter(c => c.lineType !== null)
)
const fullFileComments = computed(() =>
  props.comments.filter(c => c.lineType === null)
)
</script>

<template>
  <HorizontalScrollBody class="diff-file-card__body" :label="path">
    <DiffFileFullView
      v-if="viewMode === 'full'"
      :path="path"
      :commentable="commentable"
      :comments-editable="commentsEditable"
      :comments="fullFileComments"
      :wrap="wrap"
    />
    <template v-else>
      <p
        v-if="file.isBinary"
        class="text-caption text-grey-6 q-pa-md q-mb-none"
      >
        {{ t('changes.binaryFile') }}
      </p>
      <div
        v-else-if="hunksState === 'loading'"
        class="diff-file-card__loading row flex-center"
        :style="{ minHeight: `${loadingHeight}px` }"
      >
        <q-spinner
          size="md"
          color="grey-6"
          :aria-label="t('changes.hunksLoading')"
        />
      </div>
      <template v-else>
        <LoadErrorBanner
          v-if="hunksState === 'error'"
          :title="t('changes.hunksLoadError')"
          :message="hunksError ?? ''"
          :loading="false"
          @retry="emit('retry-hunks')"
        />
        <p
          v-else-if="file.hunks.length === 0"
          class="text-caption text-grey-6 q-pa-md q-mb-none"
        >
          {{ t('changes.noTextChanges') }}
        </p>
      </template>
      <DiffHunkView
        v-for="(hunk, index) in file.hunks"
        :key="`${hunk.oldStart}:${hunk.newStart}`"
        :path="path"
        :hunk="hunk"
        :line-tokens="hunkTokens?.[index] ?? null"
        :commentable="commentable"
        :comments-editable="commentsEditable"
        :comments="diffComments"
        :comments-only="commentsOnly"
        :wrap="wrap"
      />
    </template>
  </HorizontalScrollBody>
</template>

<style scoped>
.diff-file-card__body {
  border-top: 1px solid rgba(128, 128, 128, 0.2);
}
</style>
