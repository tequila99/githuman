<script setup lang="ts">
import { computed, nextTick, provide, useTemplateRef, watch } from 'vue'
import type { Comment, DiffFile } from '@/api/types'
import DiffFileCardBody from '@/components/DiffFileCardBody.vue'
import DiffFileCardHeader from '@/components/DiffFileCardHeader.vue'
import FileCardFrame from '@/components/FileCardFrame.vue'
import RowSegment from '@/components/RowSegment.vue'
import { diffCardBodyHeight } from '@/utils/diff-card-height'
import { CARD_STATE_KEY, useCardState } from '@/composables/use-card-state'
import { useFileHighlight } from '@/composables/use-file-highlight'
import { useHunksOnDemand } from '@/composables/use-hunks-on-demand'
import { useScrollRoot } from '@/composables/use-scroll-root'
import { pathOf } from '@/utils/diff-file'
import { isMarkdown } from '@/utils/file-wrap'
import {
  offsetFromRootTop,
  scrollTopToAlign
} from '@/utils/follow-scroll-header'
import type { DiffSource } from '@/stores/diff-store'

const props = withDefaults(
  defineProps<{
    file: DiffFile
    expanded: boolean
    /** Active review for the current branch — enables gutter drag-select and comment threads (see ADR 0018). */
    commentable?: boolean
    comments?: Comment[] | undefined
    /** Read-only review view (ReviewDetailPage.vue) — diff hunks show only commented lines instead of the full file diff. */
    commentsOnly?: boolean
    /** Whether existing comments show edit/delete/resolve controls — see DiffHunkView.vue. */
    commentsEditable?: boolean
    /** Which side of the diff this card shows — enables "add diff to agent chat" in its menu. */
    agentSource?: DiffSource | undefined
    previewRef?: string | undefined
    /**
     * Key in the card state store (`cardStateKey`). Set, the card keeps its view mode, line
     * selection and comment drafts there, so they survive an unmount by the virtual list.
     * Unset, that state is local to the card.
     */
    stateKey?: string | undefined
    /**
     * The file with its hunks (ADR 0033). `file` is the list entry without hunks. Unset, `file`
     * itself holds the hunks (review page).
     */
    detail?: DiffFile | undefined
    /** False while the hunks in `detail` are missing or stale: the card asks for them. */
    hunksLoaded?: boolean
    hunksError?: string | undefined
    /** Hides the "show full file" toggle (e.g. in review views where only the diff makes sense). */
    noFullFile?: boolean
  }>(),
  {
    commentable: false,
    comments: () => [],
    noFullFile: false,
    hunksLoaded: true
  }
)

const emit = defineEmits<{
  (e: 'toggle'): void
  (e: 'load-hunks'): void
  (e: 'retry-hunks'): void
  /** The card closed: an old error must not stop the next attempt. */
  (e: 'clear-hunks-error'): void
  (e: 'expand'): void
}>()

const path = computed(() => pathOf(props.file))
const fullFile = computed(() => props.detail ?? props.file)

const frame = useTemplateRef<InstanceType<typeof FileCardFrame>>('frame')
const scrollRoot = useScrollRoot()

/**
 * A collapse from a sticky header shrinks the card above the scroll window. Then
 * a later card fills the window. So the collapsed card moves back to the top of
 * the window, as on GitHub (#77). The parent collapses the card, so the check
 * runs before the emit.
 */
function toggle() {
  const element: unknown = frame.value?.$el
  const root = element instanceof Element ? scrollRoot(element) : null
  const stuck =
    props.expanded &&
    element instanceof Element &&
    root !== null &&
    offsetFromRootTop(root, element) < 0
  emit('toggle')
  if (!stuck) return
  void nextTick(() => {
    if (props.expanded) return
    root.scrollTop = scrollTopToAlign(root, element)
  })
}

// `stateKey` does not change in a live card: a new source makes a new `q-virtual-scroll`
// (its `:key`), and each slot is keyed by path. So the key is read once here.
provide(CARD_STATE_KEY, props.stateKey)

// Without a key (review page), the state stays in the card.
const ownState = props.stateKey ? { key: props.stateKey } : { local: true }
const wrap = useCardState('wrap', () => isMarkdown(path.value), ownState)
const viewMode = useCardState<'diff' | 'full'>(
  'viewMode',
  () => 'diff',
  ownState
)

// The full view reads the file from disk and follows its edits (#39), so an edit keeps
// the mode. A deleted file hides the toggle, so the mode goes back to the diff (ADR 0034).
watch(
  () => props.file.status,
  status => {
    if (status === 'deleted') viewMode.reset()
  },
  { immediate: true }
)

// Height guess for an open body while its hunks load. The hunks and their rows
// mount later, and only near the window (ADR 0040).
const bodyHeightEstimate = computed(() =>
  diffCardBodyHeight(props.file, props.detail)
)

// Only the open body of this card needs its hunks.
const { bodyMounted } = useHunksOnDemand({
  expanded: () => props.expanded,
  loaded: () => props.hunksLoaded,
  error: () => props.hunksError,
  version: () => props.file,
  onNeeded: () => emit('load-hunks'),
  onCollapsed: () => emit('clear-hunks-error')
})

// Older hunks stay on screen while new ones load, and also under an error banner.
const hunksState = computed<'loading' | 'error' | 'ready'>(() => {
  if (props.hunksLoaded) return 'ready'
  if (props.hunksError) return 'error'
  return props.detail ? 'ready' : 'loading'
})

// A summary without hunks is an empty file: skip it. The review page passes no `detail`
// and always has its hunks, so `hunksLoaded` covers it. The full file view shows no hunks.
const { hunkTokens, holdForTokens } = useFileHighlight(
  fullFile,
  () =>
    props.expanded &&
    viewMode.value === 'diff' &&
    (props.detail !== undefined || props.hunksLoaded)
)

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
</script>

<template>
  <FileCardFrame
    :id="`diff-file-${path}`"
    ref="frame"
    sticky-header
    class="diff-file-card"
  >
    <template #header>
      <DiffFileCardHeader
        v-model:show-full-file="showFullFile"
        v-model:wrap="wrap"
        :path="path"
        :status="file.status"
        :additions="file.additions"
        :deletions="file.deletions"
        :expanded="expanded"
        :comment-count="comments.length"
        :full-file-toggle="!noFullFile && file.status !== 'deleted'"
        :agent-source="agentSource"
        :preview-ref="previewRef"
        @toggle="toggle"
      />
    </template>

    <!-- The body mounts at once: its hunks mount near the window, and the hunk request needs it. -->
    <RowSegment
      v-if="expanded"
      immediate
      :min-height="bodyHeightEstimate"
      @change="mounted => (bodyMounted = mounted)"
    >
      <DiffFileCardBody
        :file="fullFile"
        :path="path"
        :view-mode="viewMode"
        :wrap="wrap"
        :hunk-tokens="hunkTokens"
        :hunks-state="hunksState"
        :hold-for-tokens="holdForTokens"
        :hunks-error="hunksError"
        :loading-height="bodyHeightEstimate"
        :commentable="commentable"
        :comments-editable="commentsEditable"
        :comments-only="commentsOnly"
        :comments="comments"
        @retry-hunks="emit('retry-hunks')"
      />
    </RowSegment>
  </FileCardFrame>
</template>

<style scoped>
.diff-file-card {
  margin-bottom: 8px;
}
</style>
