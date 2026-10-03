<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useActiveReviewStore } from '@/stores/active-review-store'
import { useAgentStore } from '@/stores/agent-store'
import { useAddAgentContext } from '@/composables/use-add-agent-context'
import StatusSwitcher from './StatusSwitcher.vue'
import { ADD_TO_CHAT_ICON } from '@/utils/agent-icon'
import type { ReviewStatus } from '@/api/types'
import { useNotifyError } from '@/composables/use-notify-error'

const { t } = useI18n()
const notifyError = useNotifyError()
const activeReviewStore = useActiveReviewStore()
const { activeReview } = storeToRefs(activeReviewStore)
const agent = useAgentStore()
const addToChat = useAddAgentContext()

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
    <q-icon name="rate_review" size="18px" color="primary" />
    <span class="text-body2 ellipsis">
      {{ activeReview.name ?? t('reviews.list.unnamed') }}
    </span>
    <q-space />
    <q-btn
      v-if="agent.enabled"
      flat
      dense
      no-caps
      size="sm"
      :icon="ADD_TO_CHAT_ICON"
      :label="t('agent.context.addReview')"
      @click="addToChat({ kind: 'review', reviewId: activeReview.id })"
    />
    <StatusSwitcher :status="activeReview.status" @change="changeStatus" />
  </div>
</template>

<style scoped>
.active-review-bar {
  min-height: 36px;
}
</style>
