<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Review, ReviewStatus } from '@/api/types'

const props = defineProps<{ review: Review }>()
defineEmits<{ (e: 'click'): void }>()

const { t } = useI18n()

const STATUS_COLOR: Record<ReviewStatus, string> = {
  in_progress: 'grey-7',
  approved: 'positive',
  changes_requested: 'negative'
}

const name = computed(() => props.review.name ?? t('reviews.list.unnamed'))
const branch = computed(
  () => props.review.branch ?? t('reviews.list.unknownBranch')
)
const createdAt = computed(() =>
  new Date(props.review.createdAt).toLocaleString()
)
</script>

<template>
  <q-item v-ripple clickable @click="$emit('click')">
    <q-item-section avatar>
      <q-icon :color="STATUS_COLOR[review.status]" name="rate_review" />
    </q-item-section>
    <q-item-section>
      <q-item-label class="text-body2">{{ name }}</q-item-label>
      <q-item-label caption>
        <q-icon name="account_tree" size="14px" class="q-mr-xs" />{{ branch }}
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
