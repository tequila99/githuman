<script setup lang="ts">
import { computed, nextTick, provide, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type { QScrollArea } from 'quasar'
import { useFileExplorerStore } from '@/stores/file-explorer-store'
import { useActiveReviewStore } from '@/stores/active-review-store'
import { useDiffStore } from '@/stores/diff-store'
import { pathOf } from '@/utils/diff-file'
import { equalArrays } from '@/utils/equal-arrays'
import { SCROLL_ROOT_KEY } from '@/composables/use-scroll-root'
import {
  useFileScroll,
  type VirtualScrollApi
} from '@/composables/use-file-scroll'
import { CARD_HEIGHT_ESTIMATE } from '@/utils/diff-card-height'
import { provideCommentActions } from '@/composables/use-comment-actions'
import DiffStatusBar from './DiffStatusBar.vue'
import ChangesFileCard from './ChangesFileCard.vue'
import ActiveReviewBar from './ActiveReviewBar.vue'
import LoadErrorBanner from './LoadErrorBanner.vue'
import CreateReviewFabButton from './buttons/CreateReviewFabButton.vue'

// How many rows the list draws around the window, and how many before and after
// per window height. More rows after than before: people scroll down.
const SLICE_SIZE = 12
const SLICE_RATIO_BEFORE = 1.5
const SLICE_RATIO_AFTER = 2

const { t } = useI18n()

const explorer = useFileExplorerStore()
const { diffFiles } = storeToRefs(explorer)
const { error: loadError, loading: diffLoading } = storeToRefs(useDiffStore())
const activeReviewStore = useActiveReviewStore()
const { activeReview } = storeToRefs(activeReviewStore)

// The cards in this list change comments of the active review.
provideCommentActions({
  create: input => activeReviewStore.createComment(input),
  edit: (id, content) => activeReviewStore.editComment(id, content),
  remove: id => activeReviewStore.deleteComment(id),
  resolve: id => activeReviewStore.resolveComment(id),
  unresolve: id => activeReviewStore.unresolveComment(id)
})

// The element that scrolls the cards: `q-virtual-scroll` and the row segments watch it.
// A template ref is set after the children mount, so the list renders once it is known.
const scrollArea = ref<QScrollArea | null>(null)
const scrollTarget = computed(() => scrollArea.value?.getScrollTarget() ?? null)
provide(SCROLL_ROOT_KEY, () => scrollTarget.value)

const virtualScroll = ref<VirtualScrollApi | null>(null)
useFileScroll({
  request: () => explorer.scrollRequest,
  list: virtualScroll,
  root: scrollTarget
})

// Quasar measures rows once and resets only when the list length changes.
// Expand all, Collapse all and a switch of the source change heights at the same length.
watch(
  () => explorer.layoutVersion,
  async () => {
    await nextTick()
    virtualScroll.value?.reset()
  }
)

// Other paths at the same list length leave old heights at the wrong rows. A change of
// content only does not reset: a reset drops every measured height, and an agent edits
// often. Quasar measures a mounted card again when the list scrolls.
watch(diffFiles, async (files, previous) => {
  if (equalArrays(files, previous, (x, y) => pathOf(x) === pathOf(y))) return
  await nextTick()
  virtualScroll.value?.reset()
})
</script>

<template>
  <!-- Here rather than in the sidebar: that one can be collapsed. -->
  <LoadErrorBanner
    v-if="loadError"
    :title="t('changes.loadError')"
    :message="loadError"
    :loading="diffLoading"
    @retry="explorer.refresh()"
  />

  <!-- With a load error, "no changes" would be a claim we can't make. -->
  <div v-if="diffFiles.length === 0 && !loadError" class="q-pa-md text-grey-6">
    {{ t('changes.emptyDiffPanel') }}
  </div>

  <template v-else-if="diffFiles.length > 0">
    <ActiveReviewBar />
    <q-separator v-if="activeReview" />
    <DiffStatusBar
      :files="diffFiles"
      @expand-all="explorer.expandAllFiles"
      @collapse-all="explorer.collapseAllFiles"
    />
    <q-separator />
    <q-scroll-area
      ref="scrollArea"
      class="col sticky-header-scroll"
      content-style="padding: 8px; width: 100%; max-width: 100%"
      content-active-style="padding: 8px; width: 100%; max-width: 100%"
    >
      <!-- The key holds the source: with the same length Quasar would keep the old heights. -->
      <q-virtual-scroll
        v-if="scrollTarget"
        :key="explorer.source"
        ref="virtualScroll"
        :scroll-target="scrollTarget"
        :items="diffFiles"
        :virtual-scroll-item-size="CARD_HEIGHT_ESTIMATE"
        :virtual-scroll-slice-size="SLICE_SIZE"
        :virtual-scroll-slice-ratio-before="SLICE_RATIO_BEFORE"
        :virtual-scroll-slice-ratio-after="SLICE_RATIO_AFTER"
      >
        <template #default="{ item: file }">
          <!-- No overflow or contain here: either would break the sticky bars inside the card. -->
          <div :key="pathOf(file)" class="diff-virtual-slot">
            <ChangesFileCard :file="file" />
          </div>
        </template>
      </q-virtual-scroll>
    </q-scroll-area>
  </template>
  <CreateReviewFabButton v-if="!activeReview && diffFiles.length > 0" />
</template>

<style scoped>
/* The virtual list measures a row without its margin, so the gap is padding inside the row. */
.diff-virtual-slot {
  padding-bottom: 8px;
}

.diff-virtual-slot :deep(.diff-file-card) {
  margin-bottom: 0;
}
</style>
