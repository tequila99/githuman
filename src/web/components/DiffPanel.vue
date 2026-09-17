<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import { useFileExplorerStore } from '@/stores/file-explorer-store'
import { useActiveReviewStore } from '@/stores/active-review-store'
import { pathOf } from '@/utils/diff-file'
import type { CreateCommentRequest } from '@/api/types'
import DiffStatusBar from './DiffStatusBar.vue'
import DiffFileCard from './DiffFileCard.vue'
import ActiveReviewBar from './ActiveReviewBar.vue'
import CreateReviewFabButton from './buttons/CreateReviewFabButton.vue'

const { t } = useI18n()
const $q = useQuasar()

const explorer = useFileExplorerStore()
const activeReviewStore = useActiveReviewStore()
const { source, diffFiles, expandedFiles } = storeToRefs(explorer)
const { activeReview, commentsByFile } = storeToRefs(activeReviewStore)

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

function createComment(input: CreateCommentRequest) {
  void notifyOnError(() => activeReviewStore.createComment(input))
}
function editComment(id: string, content: string) {
  void notifyOnError(() => activeReviewStore.editComment(id, content))
}
function deleteComment(id: string) {
  void notifyOnError(() => activeReviewStore.deleteComment(id))
}
function resolveComment(id: string) {
  void notifyOnError(() => activeReviewStore.resolveComment(id))
}
function unresolveComment(id: string) {
  void notifyOnError(() => activeReviewStore.unresolveComment(id))
}
</script>

<template>
  <div v-if="diffFiles.length === 0" class="q-pa-md text-grey-6">
    {{ t('changes.emptyDiffPanel') }}
  </div>

  <template v-else>
    <ActiveReviewBar />
    <q-separator v-if="activeReview" />
    <DiffStatusBar
      :files="diffFiles"
      @expand-all="explorer.expandAllFiles"
      @collapse-all="explorer.collapseAllFiles"
    />
    <q-separator />
    <q-scroll-area
      class="col"
      content-style="padding: 8px"
      content-active-style="padding: 8px"
    >
      <DiffFileCard
        v-for="file in diffFiles"
        :key="pathOf(file)"
        :file="file"
        :source="source"
        :expanded="expandedFiles.has(pathOf(file))"
        :commentable="!!activeReview"
        :comments-editable="!!activeReview"
        :comments="commentsByFile.get(pathOf(file)) ?? []"
        @toggle="explorer.handleCardToggle(pathOf(file))"
        @expand="explorer.expandFile(pathOf(file))"
        @create-comment="createComment"
        @edit-comment="editComment"
        @delete-comment="deleteComment"
        @resolve-comment="resolveComment"
        @unresolve-comment="unresolveComment"
      />
    </q-scroll-area>
  </template>
  <CreateReviewFabButton v-if="!activeReview && diffFiles.length > 0" />
</template>
