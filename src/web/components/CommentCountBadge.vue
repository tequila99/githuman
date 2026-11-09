<script setup lang="ts">
import { mdiCommentOutline } from '@mdi/js'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import { useI18n } from 'vue-i18n'

defineProps<{ count: number; compact?: boolean }>()

const { t } = useI18n()
</script>

<template>
  <span
    v-if="count > 0"
    class="comment-count-badge relative-position inline-block"
  >
    <q-icon
      class="app-icon-neutral"
      :name="mdiCommentOutline"
      :size="compact ? '15px' : '20px'"
    />
    <q-badge color="primary" floating class="app-icon-badge">{{
      count
    }}</q-badge>
    <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
      t('reviews.comments.count', { count })
    }}</q-tooltip>
  </span>
</template>

<style scoped>
.comment-count-badge {
  margin-left: 8px;
  color: var(--diff-gutter-color);
}
</style>
