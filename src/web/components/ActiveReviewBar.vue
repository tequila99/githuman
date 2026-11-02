<script setup lang="ts">
import AddToAgentButton from '@/components/buttons/AddToAgentButton.vue'
import { mdiCommentEditOutline } from '@mdi/js'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useActiveReviewStore } from '@/stores/active-review-store'
import StatusSwitcher from './StatusSwitcher.vue'
import type { ReviewStatus } from '@/api/types'
import { useNotifyError } from '@/composables/use-notify-error'

const { t } = useI18n()
const notifyError = useNotifyError()
const activeReviewStore = useActiveReviewStore()
const { activeReview } = storeToRefs(activeReviewStore)

function changeStatus(status: ReviewStatus) {
  activeReviewStore.setStatus(status).catch((err: unknown) => {
    notifyError(t('reviews.comments.error'), err)
  })
}
</script>

<template>
  <div
    v-if="activeReview"
    class="active-review-bar row items-center q-gutter-x-sm q-px-sm no-wrap"
  >
    <q-icon :name="mdiCommentEditOutline" size="18px" color="primary" />
    <span class="text-body2 ellipsis">
      {{ activeReview.name ?? t('reviews.list.unnamed') }}
    </span>
    <q-space />
    <AddToAgentButton
      text
      size="sm"
      :label="t('agent.context.addReview')"
      :context="{ kind: 'review', reviewId: activeReview.id }"
    />
    <StatusSwitcher :status="activeReview.status" @change="changeStatus" />
  </div>
</template>

<style scoped>
.active-review-bar {
  min-height: 36px;
}
</style>
