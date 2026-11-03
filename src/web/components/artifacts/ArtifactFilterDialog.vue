<script setup lang="ts">
import { computed, ref } from 'vue'
import { ARTIFACT_STATUSES } from '../../../shared/artifacts/constants.ts'
import { useI18n } from 'vue-i18n'
import { useAppTheme } from '@/composables/use-app-theme'
import FilterDialog from '@/components/FilterDialog.vue'
import TagFilterField from '@/components/TagFilterField.vue'
import {
  artifactFiltersActive,
  defaultArtifactFilters
} from '@/utils/artifact-navigation'
import type { ArtifactCatalogFilters } from '@/types/artifacts'
import ArtifactDefinitionPicker from './ArtifactDefinitionPicker.vue'

const open = defineModel<boolean>({ required: true })
const filter = defineModel<ArtifactCatalogFilters>('filter', { required: true })
const props = defineProps<{ storeId: string | null; tagOptions: string[] }>()
const { t } = useI18n()
const { isDark } = useAppTheme()
const pending = ref<ArtifactCatalogFilters>(defaultArtifactFilters())
const active = computed(() => artifactFiltersActive(pending.value))
// Selected tags stay listed even when the loaded results no longer hold them.
const tagChoices = computed(() => [
  ...new Set([...props.tagOptions, ...pending.value.tags])
])
const statuses = computed(() => [
  { label: t('artifacts.allStatuses'), value: null },
  ...ARTIFACT_STATUSES.map(value => ({
    label: t('artifacts.statuses.' + value),
    value
  }))
])
const groupings = computed(() =>
  ['none', 'type', 'task'].map(value => ({
    label: t('artifacts.groups.' + value),
    value
  }))
)
function prepare() {
  pending.value = {
    ...filter.value,
    typeIds: [...filter.value.typeIds],
    tags: [...filter.value.tags]
  }
}
function reset() {
  pending.value = defaultArtifactFilters()
}
function apply() {
  filter.value = { ...pending.value }
  open.value = false
}
function setTypes(value: string | string[] | null) {
  pending.value.typeIds = Array.isArray(value) ? value : []
}
function setTask(value: string | string[] | null) {
  pending.value.taskId = typeof value === 'string' ? value : null
}
</script>

<template>
  <FilterDialog
    v-model="open"
    :can-reset="active"
    width="640px"
    @prepare="prepare"
    @reset="reset"
    @apply="apply"
  >
    <q-select
      v-model="pending.status"
      :dark="isDark"
      outlined
      dense
      clearable
      emit-value
      map-options
      :options="statuses"
      :display-value="
        pending.status === null
          ? t('artifacts.allStatuses')
          : t('artifacts.statuses.' + pending.status)
      "
      :label="t('artifacts.status')"
    />
    <ArtifactDefinitionPicker
      v-if="storeId"
      :key="'type:' + storeId"
      :model-value="pending.typeIds"
      :store-id="storeId"
      kind="type"
      multiple
      @update:model-value="setTypes"
    />
    <ArtifactDefinitionPicker
      v-if="storeId"
      :key="'task:' + storeId"
      :model-value="pending.taskId"
      :store-id="storeId"
      kind="task"
      @update:model-value="setTask"
    />
    <TagFilterField
      v-model:tags="pending.tags"
      v-model:mode="pending.tagMode"
      :options="tagChoices"
      allow-create
    />
    <q-input
      v-model="pending.createdFrom"
      :dark="isDark"
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
      :dark="isDark"
      outlined
      dense
      clearable
      stack-label
      type="date"
      :min="pending.createdFrom ?? undefined"
      :label="t('artifacts.createdTo')"
    />
    <q-select
      v-model="pending.group"
      :dark="isDark"
      outlined
      dense
      emit-value
      map-options
      :options="groupings"
      :label="t('artifacts.group')"
    />
    <q-toggle
      :dark="isDark"
      :model-value="pending.mode === 'auto'"
      :label="t('artifacts.typos')"
      @update:model-value="value => (pending.mode = value ? 'auto' : 'exact')"
    />
  </FilterDialog>
</template>
