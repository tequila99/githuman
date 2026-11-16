<script setup lang="ts">
import { shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiSourceBranch } from '@mdi/js'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import SearchInput from '@/components/SearchInput.vue'
import FilterButton from '@/components/buttons/FilterButton.vue'
import RefreshButton from '@/components/buttons/RefreshButton.vue'
import TextButton from '@/components/buttons/TextButton.vue'
import JournalFilterDialog from './JournalFilterDialog.vue'
import {
  journalFiltersActive,
  type JournalFilters
} from '@/utils/journal-navigation'

defineProps<{
  text: string
  filters: JournalFilters
  grouped: boolean
  loading: boolean
  hasUpdates: boolean
  agentNames: string[]
  models: string[]
  storeId: string | null
}>()
const emit = defineEmits<{
  search: [value: string | null | undefined]
  apply: [filters: JournalFilters]
  toggleGrouping: []
  refresh: []
}>()
const { t } = useI18n()
const filtersOpen = shallowRef(false)
</script>

<template>
  <header class="q-pa-md">
    <div class="row items-center q-gutter-sm q-mb-sm">
      <h1 class="text-h6 q-ma-none col">{{ t('journal.project.title') }}</h1>
      <FilterButton
        :active="journalFiltersActive(filters)"
        @click="filtersOpen = true"
      />
      <RefreshButton
        :tooltip="t('journal.refresh')"
        :loading="loading"
        @click="emit('refresh')"
      />
    </div>
    <div class="row no-wrap items-center q-gutter-x-xs">
      <SearchInput
        class="col"
        :model-value="text"
        :debounce="250"
        :maxlength="256"
        :label="t('journal.project.search')"
        @update:model-value="value => emit('search', value)"
      />
      <q-btn
        class="app-icon-control"
        flat
        dense
        round
        size="sm"
        :icon="mdiSourceBranch"
        :color="grouped ? 'primary' : undefined"
        :aria-label="t('artifacts.groupByTask')"
        :aria-pressed="grouped"
        @click="emit('toggleGrouping')"
      >
        <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
          t('artifacts.groupByTask')
        }}</q-tooltip>
      </q-btn>
    </div>
    <TextButton
      v-if="hasUpdates"
      class="q-mt-sm"
      :label="t('journal.project.updates')"
      :loading="loading"
      @click="emit('refresh')"
    />
  </header>
  <JournalFilterDialog
    v-model="filtersOpen"
    :filters="filters"
    :agent-names="agentNames"
    :models="models"
    :store-id="storeId"
    @apply="emit('apply', $event)"
  />
</template>
