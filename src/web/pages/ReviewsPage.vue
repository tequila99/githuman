<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useReviewsStore } from '@/stores/reviews-store'
import { useServerEvents } from '@/composables/use-server-events'
import ReviewFilters from '@/components/ReviewFilters.vue'
import ReviewListItem from '@/components/ReviewListItem.vue'
import CreateReviewFabButton from '@/components/buttons/CreateReviewFabButton.vue'
import AppPage from '@/components/AppPage.vue'
import type { Review } from '@/api/types'

const { t } = useI18n()
const router = useRouter()
const store = useReviewsStore()
const { reviews, loading } = storeToRefs(store)

const search = ref<string | null>(null)
const createdFrom = ref<string | null>(null)
const createdTo = ref<string | null>(null)
const files = ref<string[]>([])

function refetch() {
  void store.fetchReviews({
    search: search.value ?? '',
    createdFrom: createdFrom.value,
    createdTo: createdTo.value,
    files: files.value
  })
}

onMounted(refetch)
watch([search, createdFrom, createdTo, files], refetch)

const events = useServerEvents(
  ['review:created', 'review:updated', 'review:deleted'],
  refetch
)
onUnmounted(() => events.close())

function openReview(id: string) {
  void router.push(`/reviews/${id}`)
}

function onCreated(review: Review) {
  void router.push(`/reviews/${review.id}`)
}
</script>

<template>
  <AppPage class="reviews-page column no-wrap">
    <div class="text-h6 q-px-sm">{{ t('nav.reviews') }}</div>
    <q-separator />

    <ReviewFilters
      v-model:search="search"
      v-model:created-from="createdFrom"
      v-model:created-to="createdTo"
      v-model:files="files"
    />
    <q-separator />
    <q-scroll-area class="col">
      <div v-if="loading" class="row justify-center q-pa-lg">
        <q-spinner color="primary" size="2em" />
      </div>
      <div
        v-else-if="reviews.length === 0"
        class="q-pa-lg text-center text-grey-6"
      >
        <p>{{ t('reviews.list.empty') }}</p>
        <q-btn
          flat
          color="primary"
          :label="t('reviews.list.emptyAction')"
          :to="{ path: '/' }"
        />
      </div>
      <q-list class="q-pa-md" separator padding>
        <ReviewListItem
          v-for="review in reviews"
          :key="review.id"
          :review="review"
          @click="openReview(review.id)"
        />
      </q-list>
    </q-scroll-area>
    <CreateReviewFabButton @created="onCreated" />
  </AppPage>
</template>

<style scoped>
.reviews-page {
  height: 100%;
  display: flex;
}
</style>
