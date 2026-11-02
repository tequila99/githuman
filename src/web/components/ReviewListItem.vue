<script setup lang="ts">
import { mdiCommentEditOutline, mdiSourceBranch } from '@mdi/js'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ReviewStatus, ReviewSummary } from '@/api/types'
import { formatDateTime } from '@/utils/date'

// Keep status colors consistent across this component.
const STATUS_COLOR: Record<ReviewStatus, string> = {
  in_progress: 'grey-7',
  approved: 'positive',
  changes_requested: 'negative'
}

// Icon roles retain sufficient contrast on both light and dark row backgrounds.
const STATUS_ICON_COLOR: Record<ReviewStatus, string> = {
  in_progress: 'var(--app-icon-neutral)',
  approved: 'var(--app-icon-success)',
  changes_requested: 'var(--app-icon-danger)'
}

const props = defineProps<{ review: ReviewSummary }>()
defineEmits<{ (e: 'click'): void }>()

const { t } = useI18n()

const name = computed(() => props.review.name ?? t('reviews.list.unnamed'))
const branch = computed(
  () => props.review.branch ?? t('reviews.list.unknownBranch')
)
const createdAt = computed(() => formatDateTime(props.review.createdAt))
</script>

<template>
  <q-item v-ripple clickable @click="$emit('click')">
    <q-item-section avatar>
      <q-icon
        :style="{ color: STATUS_ICON_COLOR[review.status] }"
        :name="mdiCommentEditOutline"
      />
    </q-item-section>
    <q-item-section>
      <q-item-label class="text-body2">{{ name }}</q-item-label>
      <q-item-label caption>
        <q-icon
          :name="mdiSourceBranch"
          size="14px"
          class="app-icon-neutral q-mr-xs"
        />{{ branch }}
        <span class="q-mx-sm">&middot;</span>
        {{ createdAt }}
      </q-item-label>
    </q-item-section>
    <q-item-section side>
      <q-badge :color="STATUS_COLOR[review.status]" outline rounded>
        {{ t(`reviews.status.${review.status}`) }}
      </q-badge>
    </q-item-section>
  </q-item>
</template>
