<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DiffFile } from '@/api/types'

const props = defineProps<{ files: DiffFile[] }>()

const emit = defineEmits<{
  (e: 'expand-all'): void
  (e: 'collapse-all'): void
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
    class="diff-status-bar row items-center q-gutter-x-md q-pa-sm text-body2"
  >
    <span class="text-weight-medium">
      {{ t('changes.filesChanged', { count: stats.total }) }}
    </span>
    <span class="text-positive">
      +{{ stats.additions }} {{ t('changes.additions') }}
    </span>
    <span class="text-negative">
      -{{ stats.deletions }} {{ t('changes.deletions') }}
    </span>
    <span v-if="stats.added" class="text-grey-6">
      {{ stats.added }} {{ t('changes.added') }}
    </span>
    <span v-if="stats.modified" class="text-grey-6">
      {{ stats.modified }} {{ t('changes.modified') }}
    </span>
    <span v-if="stats.deleted" class="text-grey-6">
      {{ stats.deleted }} {{ t('changes.deletedPlural') }}
    </span>
    <span v-if="stats.renamed" class="text-grey-6">
      {{ stats.renamed }} {{ t('changes.renamed') }}
    </span>

    <q-space />

    <q-btn
      dense
      flat
      no-caps
      size="sm"
      icon="unfold_more"
      :label="t('changes.expandAll')"
      @click="emit('expand-all')"
    />
    <q-btn
      dense
      flat
      no-caps
      size="sm"
      icon="unfold_less"
      :label="t('changes.collapseAll')"
      @click="emit('collapse-all')"
    />
  </div>
</template>
