<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{ count: number; compact?: boolean }>()

const { t } = useI18n()
</script>

<template>
  <span
    v-if="count > 0"
    class="comment-count-badge relative-position inline-block"
    :class="{ 'comment-count-badge--compact': compact }"
  >
    <q-icon name="mode_comment" :size="compact ? '15px' : '20px'" />
    <q-badge color="primary" floating rounded>{{ count }}</q-badge>
    <q-tooltip>{{ t('reviews.comments.count', { count }) }}</q-tooltip>
  </span>
</template>

<style scoped>
.comment-count-badge {
  margin-left: 8px;
  color: var(--diff-gutter-color);
}

/* A count badge this close in size to the icon it floats over would
   otherwise sit on top of it (Quasar's default floating offset is
   top:-4px/right:-3px) — push it further to the outside corner so the
   speech-bubble glyph stays fully visible underneath. */
.comment-count-badge :deep(.q-badge--floating) {
  top: -7px;
  right: -9px;
}

.comment-count-badge--compact :deep(.q-badge--floating) {
  top: -5px;
  right: -7px;
  min-height: 12px;
  padding: 1px 4px;
  font-size: 9px;
  line-height: 1;
}
</style>
