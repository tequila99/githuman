<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FilterButton from '@/components/buttons/FilterButton.vue'
import ResetFiltersButton from '@/components/buttons/ResetFiltersButton.vue'
import {
  artifactFiltersActive,
  defaultArtifactFilters
} from '@/utils/artifact-navigation'
import type { ArtifactCatalogFilters } from '@/types/artifacts'
import ArtifactFilterDialog from './ArtifactFilterDialog.vue'

const props = defineProps<{
  storeId: string | null
  navigationKey: string
  tagOptions: string[]
}>()
const filter = defineModel<ArtifactCatalogFilters>({ required: true })
const open = shallowRef(false)
const { t } = useI18n()
const active = computed(() => artifactFiltersActive(filter.value))
watch(
  () => props.navigationKey,
  () => {
    open.value = false
  }
)
</script>

<template>
  <div
    class="artifact-filters row no-wrap"
    role="group"
    :aria-label="t('common.filters.title')"
  >
    <FilterButton :active="active" @click="open = true" />
    <ResetFiltersButton
      v-if="active"
      @click="filter = defaultArtifactFilters()"
    />
    <ArtifactFilterDialog
      v-model="open"
      v-model:filter="filter"
      :store-id="storeId"
      :tag-options="tagOptions"
    />
  </div>
</template>
