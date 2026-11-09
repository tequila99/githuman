<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppTheme } from '@/composables/use-app-theme'
import FilterDialog from '@/components/FilterDialog.vue'
import TagFilterField from '@/components/TagFilterField.vue'
import type { TaskStateFilter } from '@/api/tasks'
import type { TaskFilter } from '@/types/tasks'
import { defaultTaskFilter, taskFilterActive } from '@/utils/task-filter'

const STATES: TaskStateFilter[] = ['all', 'open', 'closed']

const open = defineModel<boolean>({ required: true })
const filter = defineModel<TaskFilter>('filter', { required: true })
const props = defineProps<{ tagOptions: string[] }>()
const { t } = useI18n()
const { isDark } = useAppTheme()
const pending = shallowRef<TaskFilter>(defaultTaskFilter())
const active = computed(() => taskFilterActive(pending.value))
// Selected tags stay listed even when the loaded tasks no longer hold them.
const tagChoices = computed(() => [
  ...new Set([...props.tagOptions, ...pending.value.tags])
])
const states = computed(() =>
  STATES.map(value => ({ value, label: t('tasks.filter.' + value) }))
)

function prepare() {
  pending.value = { ...filter.value, tags: [...filter.value.tags] }
}
function reset() {
  pending.value = defaultTaskFilter()
}
function apply() {
  filter.value = { ...pending.value, tags: [...pending.value.tags] }
  open.value = false
}
function patch(next: Partial<TaskFilter>) {
  pending.value = { ...pending.value, ...next }
}
</script>

<template>
  <FilterDialog
    v-model="open"
    :can-reset="active"
    @prepare="prepare"
    @reset="reset"
    @apply="apply"
  >
    <q-select
      :model-value="pending.state"
      :dark="isDark"
      outlined
      dense
      emit-value
      map-options
      :options="states"
      :label="t('tasks.state.label')"
      @update:model-value="value => patch({ state: value })"
    />
    <TagFilterField
      :tags="pending.tags"
      :mode="pending.tagMode"
      :options="tagChoices"
      @update:tags="value => patch({ tags: value })"
      @update:mode="value => patch({ tagMode: value })"
    />
  </FilterDialog>
</template>
