<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useFileExplorerStore } from '@/stores/file-explorer-store'
import { useActiveReviewStore } from '@/stores/active-review-store'
import { useDiffStore } from '@/stores/diff-store'
import { cardStateKey } from '@/utils/card-state-key'
import { pathOf } from '@/utils/diff-file'
import type { DiffFile } from '@/api/types'
import DiffFileCard from './DiffFileCard.vue'

// One card of the Changes list. It reads its own state from the stores, so the list
// passes only `file`, and a store change re-renders only the cards that use it.
// `DiffFileCard` stays free of stores: the review page uses it with other data.
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

function loadHunks() {
  void diffStore.ensureHunks(explorer.source, props.file)
}

function retryHunks() {
  void diffStore.retryHunks(explorer.source, props.file)
}
</script>

<template>
  <DiffFileCard
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
</template>
