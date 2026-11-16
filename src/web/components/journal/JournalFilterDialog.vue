<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import FilterDialog from '@/components/FilterDialog.vue'
import ArtifactDefinitionPicker from '@/components/artifacts/ArtifactDefinitionPicker.vue'
import {
  defaultJournalFilters,
  journalFiltersActive,
  type JournalFilters
} from '@/utils/journal-navigation'
import { isCalendarDate } from '@/utils/date'

const open = defineModel<boolean>({ required: true })
const props = defineProps<{
  filters: JournalFilters
  storeId: string | null
  agentNames: string[]
  models: string[]
  hideTask?: boolean
}>()
const emit = defineEmits<{ apply: [filters: JournalFilters] }>()
const { t } = useI18n()
const pending = ref(defaultJournalFilters())
const rangeInvalid = computed(() =>
  Boolean(
    (pending.value.createdFrom && !isCalendarDate(pending.value.createdFrom)) ||
    (pending.value.createdTo && !isCalendarDate(pending.value.createdTo)) ||
    (pending.value.createdFrom &&
      pending.value.createdTo &&
      pending.value.createdFrom > pending.value.createdTo)
  )
)
const kinds = computed(() =>
  ['done', 'decision', 'open', 'next', 'note', 'system'].map(value => ({
    label: t('journal.kinds.' + value),
    value
  }))
)
const authors = computed(() =>
  ['user', 'agent', 'system'].map(value => ({
    label: t('journal.project.authors.' + value),
    value
  }))
)
function setTask(value: string | string[] | null) {
  pending.value = {
    ...pending.value,
    taskId: typeof value === 'string' ? value : null
  }
}
function apply() {
  if (rangeInvalid.value) return
  emit('apply', { ...pending.value })
  open.value = false
}
</script>
<template>
  <FilterDialog
    v-model="open"
    :can-reset="journalFiltersActive(pending)"
    @prepare="pending = { ...filters }"
    @reset="pending = defaultJournalFilters()"
    @apply="apply"
  >
    <ArtifactDefinitionPicker
      v-if="storeId && !hideTask"
      :key="storeId"
      :model-value="pending.taskId"
      :store-id="storeId"
      kind="task"
      @update:model-value="setTask"
    />
    <q-select
      v-model="pending.kind"
      outlined
      dense
      clearable
      emit-value
      map-options
      :options="kinds"
      :label="t('journal.kind')"
    />
    <q-select
      v-model="pending.author"
      outlined
      dense
      clearable
      emit-value
      map-options
      :options="authors"
      :label="t('journal.project.author')"
    />
    <q-select
      v-model="pending.agentName"
      outlined
      dense
      clearable
      :options="agentNames"
      :label="t('journal.project.agentName')"
    />
    <q-select
      v-model="pending.model"
      outlined
      dense
      clearable
      :options="models"
      :label="t('journal.context.model')"
    />
    <q-input
      v-model="pending.createdFrom"
      outlined
      dense
      clearable
      stack-label
      type="date"
      :max="pending.createdTo ?? undefined"
      :label="t('artifacts.createdFrom')"
    />
    <q-input
      v-model="pending.createdTo"
      outlined
      dense
      clearable
      stack-label
      type="date"
      :min="pending.createdFrom ?? undefined"
      :label="t('artifacts.createdTo')"
      :error="rangeInvalid"
      :error-message="t('journal.project.invalidRange')"
    />
  </FilterDialog>
</template>
