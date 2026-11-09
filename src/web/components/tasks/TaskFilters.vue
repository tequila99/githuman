<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import FilterButton from '@/components/buttons/FilterButton.vue'
import ResetFiltersButton from '@/components/buttons/ResetFiltersButton.vue'
import type { TaskFilter } from '@/types/tasks'
import { defaultTaskFilter, taskFilterActive } from '@/utils/task-filter'
import TaskFilterDialog from './TaskFilterDialog.vue'

defineProps<{ tagOptions: string[] }>()
const filter = defineModel<TaskFilter>({ required: true })
const open = shallowRef(false)
const { t } = useI18n()
const active = computed(() => taskFilterActive(filter.value))
</script>

<template>
  <div
    class="task-filters row no-wrap"
    role="group"
    :aria-label="t('common.filters.title')"
  >
    <FilterButton :active="active" @click="open = true" />
    <ResetFiltersButton v-if="active" @click="filter = defaultTaskFilter()" />
    <TaskFilterDialog
      v-model="open"
      v-model:filter="filter"
      :tag-options="tagOptions"
    />
  </div>
</template>
