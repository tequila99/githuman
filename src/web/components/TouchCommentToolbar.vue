<script setup lang="ts">
import { useI18n } from 'vue-i18n'
defineProps<{
  path: string
  start: number
  end: number
  /** The card checks the lines; the form appears after the check. */
  confirming: boolean
}>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const { t } = useI18n()
</script>
<template>
  <div
    class="touch-comment-toolbar q-pa-sm"
    role="region"
    :aria-label="t('workspace.selectLines')"
  >
    <div class="text-caption ellipsis"
      >{{ path }} · {{ t('workspace.extendSelection') }}</div
    >
    <div class="row items-center q-gutter-sm">
      <q-btn
        color="primary"
        no-caps
        :label="t('workspace.commentRange', { start, end })"
        :loading="confirming"
        @click="emit('confirm')"
      />
      <q-btn
        flat
        no-caps
        :label="t('workspace.cancelSelection')"
        @click="emit('cancel')"
      />
    </div>
  </div>
</template>
<style scoped>
.touch-comment-toolbar {
  flex: 0 0 auto;
  border-top: 1px solid var(--q-separator-color, rgba(128, 128, 128, 0.3));
}
</style>
