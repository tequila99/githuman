<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import { useActiveReviewStore } from '@/stores/active-review-store'
import StatusSwitcher from './StatusSwitcher.vue'
import type { ReviewStatus } from '@/api/types'

const { t } = useI18n()
const $q = useQuasar()
const activeReviewStore = useActiveReviewStore()
const { activeReview } = storeToRefs(activeReviewStore)

function changeStatus(status: ReviewStatus) {
  activeReviewStore.setStatus(status).catch((err: unknown) => {
    $q.notify({
      type: 'negative',
      message: t('reviews.comments.error'),
      caption: err instanceof Error ? err.message : String(err)
    })
  })
}
</script>

<template>
  <div
    v-if="activeReview"
    class="active-review-bar row items-center q-gutter-x-sm q-px-sm no-wrap"
  >
    <q-icon name="rate_review" size="18px" color="primary" />
    <span class="text-body2 ellipsis">
      {{ activeReview.name ?? t('reviews.list.unnamed') }}
    </span>
    <q-space />
    <StatusSwitcher :status="activeReview.status" @change="changeStatus" />
  </div>
</template>

<style scoped>
.active-review-bar {
  min-height: 36px;
}
</style>
