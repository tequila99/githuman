<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useReviewDetailStore } from '@/stores/review-detail-store'
import { useServerEvents } from '@/composables/use-server-events'
import { pathOf } from '@/utils/diff-file'
import DiffFileCard from '@/components/DiffFileCard.vue'
import StatusSwitcher from '@/components/StatusSwitcher.vue'
import AppPage from '@/components/AppPage.vue'
import DownloadButton from '@/components/buttons/DownloadButton.vue'
import type { ReviewStatus } from '@/api/types'

const { t } = useI18n()
const $q = useQuasar()
const route = useRoute()
const router = useRouter()
const store = useReviewDetailStore()
const { review, files, commentsByFile, loading } = storeToRefs(store)

const reviewId = computed(() => String(route.params.id))
const expandedFiles = ref<Set<string>>(new Set())

// Only files someone actually left a comment on are worth reviewing again —
// the rest of the (possibly large) snapshot stays hidden.
const commentedFiles = computed(() =>
  files.value.filter(
    file => (commentsByFile.value.get(pathOf(file)) ?? []).length > 0
  )
)

const downloadUrl = computed(
  () => `/api/reviews/${reviewId.value}/export?format=markdown`
)

// Characters invalid in a filename on Windows/macOS/Linux (\/:*?"<>|),
// swapped for '-' so a review's free-text name always saves cleanly.
const downloadFilename = computed(() => {
  const name = review.value?.name ?? review.value?.id ?? 'review'
  return `${name.replace(/[/\\:*?"<>|]/g, '-')}.md`
})

function load() {
  void store.load(reviewId.value)
  expandedFiles.value = new Set()
}

onMounted(load)
watch(reviewId, load)

const events = useServerEvents(
  ['comment:created', 'comment:updated', 'comment:deleted'],
  () => void store.refreshComments()
)
onUnmounted(() => events.close())

function toggleFile(path: string) {
  const next = new Set(expandedFiles.value)
  if (next.has(path)) {
    next.delete(path)
  } else {
    next.add(path)
  }
  expandedFiles.value = next
}

function expandFile(path: string) {
  expandedFiles.value = new Set(expandedFiles.value).add(path)
}

function changeStatus(status: ReviewStatus) {
  void store.setStatus(status)
}

async function notifyOnError(action: () => Promise<unknown>) {
  try {
    await action()
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: t('reviews.comments.error'),
      caption: err instanceof Error ? err.message : String(err)
    })
  }
}

function editComment(id: string, content: string) {
  void notifyOnError(() => store.editComment(id, content))
}
function deleteComment(id: string) {
  void notifyOnError(() => store.deleteComment(id))
}
function resolveComment(id: string) {
  void notifyOnError(() => store.resolveComment(id))
}
function unresolveComment(id: string) {
  void notifyOnError(() => store.unresolveComment(id))
}

function goBack() {
  void router.push('/reviews')
}
</script>

<template>
  <AppPage v-if="loading" class="row justify-center q-pa-lg">
    <q-spinner color="primary" size="2em" />
  </AppPage>

  <AppPage v-else-if="!review" class="q-pa-lg text-grey-6">
    {{ t('reviews.detail.notFound') }}
  </AppPage>

  <AppPage v-else class="review-detail-page column no-wrap q-pa-md">
    <div class="review-detail-page__header q-pa-sm">
      <div class="row items-center q-gutter-x-sm">
        <q-btn flat dense round icon="arrow_back" @click="goBack" />
        <div class="text-h6 ellipsis">
          {{ review.name ?? t('reviews.list.unnamed') }}
        </div>
        <q-space />
        <DownloadButton
          :url="downloadUrl"
          :filename="downloadFilename"
          :tooltip="t('reviews.detail.download')"
        />
      </div>
      <div class="row items-center q-gutter-x-sm q-mt-xs">
        <span class="text-caption text-grey-6">
          <q-icon name="account_tree" size="14px" />
          {{ review.branch ?? t('reviews.list.unknownBranch') }}
        </span>
        <q-space />
        <StatusSwitcher :status="review.status" @change="changeStatus" />
      </div>
    </div>
    <q-separator />

    <q-scroll-area class="col" content-style="padding: 8px">
      <p v-if="commentedFiles.length === 0" class="q-pa-md text-grey-6">
        {{ t('reviews.detail.noComments') }}
      </p>
      <DiffFileCard
        v-for="file in commentedFiles"
        :key="pathOf(file)"
        :file="file"
        source="unstaged"
        target-ref="WORKTREE"
        :expanded="expandedFiles.has(pathOf(file))"
        :comments="commentsByFile.get(pathOf(file)) ?? []"
        comments-only
        comments-editable
        no-full-file
        @toggle="toggleFile(pathOf(file))"
        @expand="expandFile(pathOf(file))"
        @edit-comment="editComment"
        @delete-comment="deleteComment"
        @resolve-comment="resolveComment"
        @unresolve-comment="unresolveComment"
      />
    </q-scroll-area>
  </AppPage>
</template>

<style scoped>
.review-detail-page {
  height: 100%;
}
</style>
