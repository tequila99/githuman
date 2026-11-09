<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import FilterButton from '@/components/buttons/FilterButton.vue'
import ResetFiltersButton from '@/components/buttons/ResetFiltersButton.vue'
import type { NoteTagFilter } from '@/types/notes'
import type { NoteEntry } from '../../../shared/notes/types.ts'
import NoteFilterDialog from './NoteFilterDialog.vue'

const props = defineProps<{ entries: NoteEntry[] }>()
const filter = defineModel<NoteTagFilter>({ required: true })
const open = shallowRef(false)
const { t } = useI18n()
const active = computed(() => filter.value.tags.length > 0)
const options = computed(() => {
  const counts = new Map<string, number>()
  for (const entry of props.entries) {
    for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b))
})
</script>
<template>
  <div
    class="note-filters row no-wrap"
    role="group"
    :aria-label="t('common.filters.title')"
  >
    <FilterButton :active="active" @click="open = true" />
    <ResetFiltersButton
      v-if="active"
      @click="filter = { ...filter, tags: [] }"
    />
    <NoteFilterDialog
      v-model="open"
      v-model:filter="filter"
      :options="options"
    />
  </div>
</template>
