<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DiffFile, DiffFileStatus } from '@/api/types'
import type { DiffSource } from '@/stores/diff-store'
import { pathOf } from '@/utils/diff-file'
import { useFileActions } from '@/composables/use-file-actions'
import { useActiveReviewStore } from '@/stores/active-review-store'
import CommentCountBadge from './CommentCountBadge.vue'

// Keep status markers consistent across file rows.
const STATUS_LABEL: Record<DiffFileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R'
}

// Use the same status colors in every file row.
const STATUS_COLOR: Record<DiffFileStatus, string> = {
  added: 'positive',
  modified: 'warning',
  deleted: 'negative',
  renamed: 'purple'
}

const props = defineProps<{
  file: DiffFile
  selected: boolean
  source: DiffSource
}>()
defineEmits<{ (e: 'click'): void }>()

const { t } = useI18n()
const { stage, unstage, discard } = useFileActions()
const activeReview = useActiveReviewStore()
const commentCount = computed(
  () => activeReview.commentsByFile.get(pathOf(props.file))?.length ?? 0
)
</script>

<template>
  <q-item
    v-ripple
    clickable
    dense
    :active="selected"
    active-class="file-list-item--selected"
    @click="$emit('click')"
  >
    <q-item-section avatar class="file-list-item__icon-section">
      <span
        class="text-caption text-weight-bold text-mono"
        :class="`text-${STATUS_COLOR[file.status]}`"
        >{{ STATUS_LABEL[file.status] }}</span
      >
    </q-item-section>
    <q-item-section class="text-mono">
      <!-- The name shrinks with an ellipsis; the badge never does, so it stays visible. -->
      <div class="file-list-item__path-row row no-wrap items-center">
        <span class="ellipsis file-list-item__path-label">
          {{ pathOf(file) }}
          <q-tooltip anchor="top middle" self="bottom middle">{{
            pathOf(file)
          }}</q-tooltip>
        </span>
        <CommentCountBadge
          v-if="commentCount > 0"
          compact
          class="file-list-item__badge"
          :count="commentCount"
        />
      </div>
    </q-item-section>
    <q-item-section side class="file-list-item__stats">
      <span class="text-caption">
        <span class="text-positive">+{{ file.additions }}</span>
        <span class="text-negative q-ml-xs">-{{ file.deletions }}</span>
      </span>
    </q-item-section>
    <q-item-section side class="file-list-item__actions">
      <template v-if="source === 'unstaged'">
        <q-btn
          v-ripple
          flat
          dense
          round
          size="sm"
          icon="undo"
          :aria-label="t('changes.actions.discard')"
          @click.stop="discard(pathOf(file))"
        >
          <q-tooltip>{{ t('changes.actions.discard') }}</q-tooltip>
        </q-btn>
        <q-btn
          v-ripple
          flat
          dense
          round
          size="sm"
          icon="add"
          :aria-label="t('changes.actions.stage')"
          @click.stop="stage(pathOf(file))"
        >
          <q-tooltip>{{ t('changes.actions.stage') }}</q-tooltip>
        </q-btn>
      </template>
      <q-btn
        v-else
        v-ripple
        flat
        dense
        round
        size="sm"
        icon="remove"
        :aria-label="t('changes.actions.unstage')"
        @click.stop="unstage(pathOf(file))"
      >
        <q-tooltip>{{ t('changes.actions.unstage') }}</q-tooltip>
      </q-btn>
    </q-item-section>
  </q-item>
</template>

<style scoped>
.file-list-item__icon-section {
  min-width: 0 !important;
  padding-right: 6px !important;
}

.file-list-item__path-row {
  width: 100%;
  min-width: 0;
}

.file-list-item__path-label {
  flex: 0 1 auto;
  min-width: 0;
}

.file-list-item__badge {
  flex: 0 0 auto;
}

.file-list-item--selected,
:deep(.file-list-item--selected) {
  font-weight: 500;
}

.file-list-item__actions {
  flex-direction: row !important;
  gap: 2px;
  padding: 0 0 0 6px !important;
}

.file-list-item__stats {
  padding-right: 0 !important;
}
</style>
