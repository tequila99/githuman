<script setup lang="ts">
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DiffFile } from '@/api/types'

const props = defineProps<{ files: DiffFile[]; anyExpanded: boolean }>()

const emit = defineEmits<{
  (e: 'toggle-all'): void
}>()

const { t } = useI18n()

const stats = computed(() => {
  const additions = props.files.reduce((sum, f) => sum + f.additions, 0)
  const deletions = props.files.reduce((sum, f) => sum + f.deletions, 0)
  const added = props.files.filter(f => f.status === 'added').length
  const modified = props.files.filter(f => f.status === 'modified').length
  const deleted = props.files.filter(f => f.status === 'deleted').length
  const renamed = props.files.filter(f => f.status === 'renamed').length
  return {
    total: props.files.length,
    additions,
    deletions,
    added,
    modified,
    deleted,
    renamed
  }
})
</script>

<template>
  <div
    class="diff-status-bar row items-center q-pa-sm text-body2 non-selectable"
    role="button"
    tabindex="0"
    :aria-label="t(anyExpanded ? 'changes.collapseAll' : 'changes.expandAll')"
    :aria-expanded="anyExpanded"
    @dblclick="emit('toggle-all')"
    @keydown.enter.prevent="!$event.repeat && emit('toggle-all')"
    @keydown.space.prevent="!$event.repeat && emit('toggle-all')"
  >
    <div class="diff-status-bar__files ellipsis">
      <span class="text-weight-medium"
        >{{ t('changes.filesChanged', stats.total) }}:</span
      >
      <span v-if="stats.added" class="text-grey-6 q-ml-sm"
        >{{ stats.added }} {{ t('changes.added') }}</span
      >
      <span v-if="stats.modified" class="text-grey-6 q-ml-sm"
        >{{ stats.modified }} {{ t('changes.modified') }}</span
      >
      <span v-if="stats.deleted" class="text-grey-6 q-ml-sm"
        >{{ stats.deleted }} {{ t('changes.deletedPlural') }}</span
      >
      <span v-if="stats.renamed" class="text-grey-6 q-ml-sm"
        >{{ stats.renamed }} {{ t('changes.renamed') }}</span
      >
    </div>
    <div class="diff-status-bar__lines row items-center q-gutter-x-md no-wrap">
      <span class="text-positive"
        >+{{ stats.additions }} {{ t('changes.additions') }}</span
      >
      <span class="text-negative"
        >-{{ stats.deletions }} {{ t('changes.deletions') }}</span
      >
    </div>

    <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
      t(anyExpanded ? 'changes.collapseAllHint' : 'changes.expandAllHint')
    }}</q-tooltip>
  </div>
</template>

<style scoped>
.diff-status-bar {
  cursor: pointer;
  gap: 4px 16px;
}
.diff-status-bar:focus-visible {
  outline: 2px solid var(--q-primary);
  outline-offset: -2px;
}
.diff-status-bar__files {
  min-width: 0;
  max-width: 100%;
}
.diff-status-bar__lines {
  white-space: nowrap;
}
/* The narrow layout class keeps this rule on the shared workspace threshold. */
.workspace--narrow .diff-status-bar__files {
  flex-basis: 100%;
}
</style>
