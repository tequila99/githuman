<script setup lang="ts">
import type { DiffFile, DiffFileStatus } from '@/api/types'
import { pathOf } from '@/utils/diff-file'

defineProps<{ file: DiffFile; selected: boolean }>()
defineEmits<{ (e: 'click'): void }>()

const STATUS_LABEL: Record<DiffFileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R'
}

const STATUS_COLOR: Record<DiffFileStatus, string> = {
  added: 'positive',
  modified: 'warning',
  deleted: 'negative',
  renamed: 'purple'
}
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
      <div class="ellipsis file-list-item__path-label">
        {{ pathOf(file) }}
        <q-tooltip anchor="top middle" self="bottom middle">{{
          pathOf(file)
        }}</q-tooltip>
      </div>
    </q-item-section>
    <q-item-section side>
      <span class="text-caption">
        <span class="text-positive">+{{ file.additions }}</span>
        <span class="text-negative q-ml-xs">-{{ file.deletions }}</span>
      </span>
    </q-item-section>
  </q-item>
</template>

<style scoped>
.file-list-item__icon-section {
  min-width: 0 !important;
  padding-right: 6px !important;
}

.file-list-item__path-label {
  width: 100%;
  min-width: 0;
}

.file-list-item--selected,
:deep(.file-list-item--selected) {
  font-weight: 500;
}
</style>
