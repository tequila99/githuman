<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import ReviewCreateDialog from '@/components/ReviewCreateDialog.vue'
import { useActiveReviewStore } from '@/stores/active-review-store'
import { useDiffStore } from '@/stores/diff-store'
import { useServerEvents } from '@/composables/use-server-events'
import type { Review } from '@/api/types'
import type { TouchPanValue } from 'quasar'

type TouchPanDetails = Parameters<NonNullable<TouchPanValue>>[0]

const emit = defineEmits<{ (e: 'created', review: Review): void }>()
const activeReviewStore = useActiveReviewStore()
const diffStore = useDiffStore()
const { activeReview } = storeToRefs(activeReviewStore)
const { changedPaths } = storeToRefs(diffStore)
const createDialogOpen = ref(false)
const openFab = ref(false)

const fabPos = ref<[number, number]>([18, 18])
const draggingFab = ref(false)

// Disabled with nothing to review (no staged or unstaged changes — a
// 'local' review snapshots both, see ADR 0018) or while a review is already
// in progress on this branch (only one active review at a time).
const disabled = computed(
  () => changedPaths.value.length === 0 || activeReview.value !== null
)

function refresh() {
  void diffStore.fetchDiff()
  void activeReviewStore.refresh()
}

onMounted(refresh)

const events = useServerEvents(
  ['files:changed', 'review:created', 'review:updated', 'review:deleted'],
  refresh
)
onUnmounted(() => events.close())

function moveFab(ev: TouchPanDetails) {
  draggingFab.value = ev.isFirst !== true && ev.isFinal !== true

  fabPos.value = [
    fabPos.value[0] - (ev.delta?.x ?? 0),
    fabPos.value[1] - (ev.delta?.y ?? 0)
  ]
}

function onCreated(review: Review) {
  activeReviewStore.setActiveReview(review)
  emit('created', review)
}
</script>

<template>
  <q-page-sticky position="bottom-right" :offset="fabPos">
    <q-fab
      v-model="openFab"
      icon="add"
      color="accent"
      :disable="disabled || draggingFab"
      v-touch-pan.prevent.mouse="moveFab"
      @click="createDialogOpen = true"
    />
  </q-page-sticky>
  <ReviewCreateDialog
    v-model="createDialogOpen"
    @created="onCreated"
    @hide="openFab = false"
  />
</template>
