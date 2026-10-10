<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, useTemplateRef } from 'vue'
import { useCardShellMount } from '@/composables/use-card-shell-mount'
import { useScrollRoot } from '@/composables/use-scroll-root'
import { useCardState } from '@/composables/use-card-state'
import { usePendingDiffComment } from '@/composables/use-pending-diff-comment'
import { usePendingFullComment } from '@/composables/use-pending-full-comment'
import { isMarkdown } from '@/utils/file-wrap'
import {
  CARD_HEIGHT_ESTIMATE,
  diffCardBodyHeight,
  commentHeightEstimate
} from '@/utils/diff-card-height'
import { THREAD_HEIGHT_ESTIMATE } from '@/utils/row-segments'
import { storeToRefs } from 'pinia'
import { useFileExplorerStore } from '@/stores/file-explorer-store'
import { useActiveReviewStore } from '@/stores/active-review-store'
import { useDiffStore } from '@/stores/diff-store'
import { cardStateKey } from '@/utils/card-state-key'
import { pathOf } from '@/utils/diff-file'
import type { DiffFile } from '@/api/types'
import DiffFileCard from './DiffFileCard.vue'

// A card shell reserves space; only a nearby shell creates a full card and loads its hunks.
const props = defineProps<{ file: DiffFile }>()

const explorer = useFileExplorerStore()
const diffStore = useDiffStore()
const activeReviewStore = useActiveReviewStore()
const { expandedFiles } = storeToRefs(explorer)
const { activeReview, commentsByFile } = storeToRefs(activeReviewStore)

const path = computed(() => pathOf(props.file))
const stateKey = computed(() => cardStateKey(explorer.source, path.value))
const detail = computed(() => diffStore.hunksOf(explorer.source, props.file))
const hunksLoaded = computed(() =>
  diffStore.hunksFresh(explorer.source, props.file)
)
const hunksError = computed(() =>
  diffStore.hunksError(explorer.source, props.file)
)
const expanded = computed(() => expandedFiles.value.has(path.value))
const comments = computed(() => commentsByFile.value.get(path.value))
const hasActiveReview = computed(() => !!activeReview.value)

// The source-keyed virtual list keeps this card key stable for the shell's lifetime.
const ownState = { key: stateKey.value }
const wrap = useCardState('wrap', () => isMarkdown(path.value), ownState)
const mode = useCardState<'diff' | 'full'>('viewMode', () => 'diff', ownState)
const pendingDiff = usePendingDiffComment(ownState)
const pendingFull = usePendingFullComment(ownState)
const pending = computed(() =>
  mode.value === 'full' ? pendingFull.value : pendingDiff.value
)
const shellHeight = computed(
  () =>
    CARD_HEIGHT_ESTIMATE +
    (expanded.value
      ? diffCardBodyHeight(props.file, detail.value) +
        commentHeightEstimate(comments.value ?? [], mode.value) +
        (pending.value ? THREAD_HEIGHT_ESTIMATE : 0)
      : 0)
)
const shellVersion = computed(() =>
  JSON.stringify([
    expanded.value,
    mode.value,
    wrap.value,
    hasActiveReview.value,
    pending.value
      ? [pending.value.column, pending.value.startKey, pending.value.endKey]
      : null,
    comments.value?.map(comment => [
      comment.id,
      comment.lineType,
      comment.lineNumberEnd,
      comment.content,
      comment.suggestion,
      comment.resolved
    ])
  ])
)
const el = useTemplateRef<HTMLElement>('el')
const { mounted, height, start, stop } = useCardShellMount(
  {
    get minHeight() {
      return shellHeight.value
    },
    get owner() {
      return detail.value ?? props.file
    },
    get version() {
      return shellVersion.value
    },
    get cacheHeight() {
      return (
        expanded.value &&
        hunksLoaded.value &&
        mode.value === 'diff' &&
        !wrap.value &&
        !comments.value?.length &&
        !pending.value
      )
    },
    get keep() {
      return !!pending.value
    }
  },
  () => el.value,
  useScrollRoot()
)
onMounted(start)
onBeforeUnmount(stop)

function loadHunks() {
  void diffStore.ensureHunks(explorer.source, props.file)
}

function retryHunks() {
  void diffStore.retryHunks(explorer.source, props.file)
}
</script>

<template>
  <div
    ref="el"
    :class="{ 'card-shell-placeholder': !mounted }"
    :style="mounted ? undefined : { height: `${height}px` }"
  >
    <DiffFileCard
      v-if="mounted"
      :file="file"
      :state-key="stateKey"
      :detail="detail"
      :hunks-loaded="hunksLoaded"
      :hunks-error="hunksError"
      :expanded="expanded"
      :agent-source="explorer.source"
      :commentable="hasActiveReview"
      :comments-editable="hasActiveReview"
      :comments="comments"
      @load-hunks="loadHunks"
      @retry-hunks="retryHunks"
      @clear-hunks-error="diffStore.clearHunksError(explorer.source, file)"
      @toggle="explorer.handleCardToggle(path)"
      @expand="explorer.expandFile(path)"
    />
    <div
      v-else
      class="card-shell-placeholder__title text-mono"
      aria-busy="true"
      >{{ path }}</div
    >
  </div>
</template>

<style scoped>
.card-shell-placeholder {
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 4px;
}
.card-shell-placeholder__title {
  height: 44px;
  padding: 6px 12px;
  background: var(--diff-header-bg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
