<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useProjectJournal } from '@/composables/tasks/use-project-journal'
import { usePaneVisibility } from '@/composables/use-pane-visibility'
import SearchInput from '@/components/SearchInput.vue'
import { formatDateTime } from '@/utils/date'
import JournalListItem from '@/components/journal/JournalListItem.vue'
import JournalEntryDialog from '@/components/journal/JournalEntryDialog.vue'
import FilterButton from '@/components/buttons/FilterButton.vue'
import JournalFilterDialog from '@/components/journal/JournalFilterDialog.vue'
import {
  defaultJournalFilters,
  journalFiltersActive,
  journalRouteState,
  journalFilterQuery
} from '@/utils/journal-navigation'
import LoadErrorBanner from '@/components/LoadErrorBanner.vue'
import TextButton from '@/components/buttons/TextButton.vue'

const props = defineProps<{
  taskId: string
  storeId: string
  active: boolean
}>()
const { t } = useI18n()
const filters = shallowRef(defaultJournalFilters())
const filtersOpen = shallowRef(false)
const query = shallowRef<string | null>('')
const paneVisible = usePaneVisibility()
const {
  items,
  agentNames,
  models,
  nextBefore,
  error,
  loading,
  loaded,
  hasUpdates,
  older,
  retry,
  refresh
} = useProjectJournal(
  () => ({
    storeId: props.storeId,
    taskId: props.taskId,
    ...journalRouteState(
      journalFilterQuery({}, filters.value) as Record<string, string>
    ).input,
    ...(query.value?.trim() ? { query: query.value.trim() } : {})
  }),
  () => props.active && paneVisible()
)
const byId = computed(
  () => new Map(items.value.map(entry => [entry.id, entry]))
)
const selectedId = shallowRef<string | null>(null)
const selectedEntry = computed(
  () => byId.value.get(selectedId.value ?? '') ?? null
)
const detailOpen = computed({
  get: () => selectedEntry.value !== null,
  set: value => {
    if (!value) selectedId.value = null
  }
})
watch(
  () => [props.storeId, props.taskId],
  () => {
    selectedId.value = null
  }
)
function correctedEntry(id: string): string {
  const target = byId.value.get(id)
  return target
    ? t('journal.correctsAt', { time: formatDateTime(target.createdAt) })
    : t('journal.correctsId', { id: id.slice(0, 8) })
}
</script>
<template>
  <div class="task-journal q-pa-md scroll fit">
    <LoadErrorBanner
      v-if="error"
      class="q-mb-md"
      :title="t('journal.error')"
      :message="error"
      :loading="loading"
      @retry="retry"
    />
    <div class="row no-wrap items-center q-gutter-x-xs q-mb-md">
      <SearchInput
        class="col"
        v-model="query"
        :debounce="250"
        :maxlength="256"
        :label="t('journal.project.search')"
      />
      <FilterButton
        :active="journalFiltersActive(filters)"
        @click="filtersOpen = true"
      />
    </div>
    <JournalFilterDialog
      v-model="filtersOpen"
      :filters="filters"
      :store-id="storeId"
      :agent-names="agentNames"
      :models="models"
      hide-task
      @apply="filters = $event"
    />
    <TextButton
      v-if="hasUpdates"
      class="q-mb-sm"
      :label="t('journal.project.updates')"
      :loading="loading"
      @click="refresh"
    />
    <q-linear-progress v-if="loading" indeterminate />
    <p v-if="loaded && !loading && !error && !items.length" class="text-grey">{{
      t('journal.project.empty')
    }}</p>
    <JournalListItem
      v-for="entry in items"
      :key="entry.id"
      :entry="entry"
      :superseded="entry.isSuperseded"
      :correction-label="
        entry.supersedesEntryId
          ? correctedEntry(entry.supersedesEntryId)
          : undefined
      "
      @click="selectedId = entry.id"
    />
    <JournalEntryDialog
      v-model="detailOpen"
      :entry="selectedEntry"
      :superseded="selectedEntry?.isSuperseded ?? false"
      :correction-label="
        selectedEntry?.supersedesEntryId
          ? correctedEntry(selectedEntry.supersedesEntryId)
          : undefined
      "
    />
    <TextButton
      v-if="nextBefore !== null"
      :label="t('journal.older')"
      :loading="loading"
      @click="older"
    />
  </div>
</template>
