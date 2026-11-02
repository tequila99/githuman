<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiFilter, mdiFilterOutline, mdiFilterRemoveOutline } from '@mdi/js'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
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
    <q-btn
      class="app-icon-control"
      flat
      round
      dense
      :icon="active ? mdiFilter : mdiFilterOutline"
      :color="active ? 'primary' : undefined"
      :aria-label="t('common.filters.title')"
      :aria-pressed="active"
      @click="open = true"
    >
      <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
        t('common.filters.title')
      }}</q-tooltip>
    </q-btn>
    <q-btn
      class="app-icon-control"
      v-if="active"
      flat
      round
      dense
      :icon="mdiFilterRemoveOutline"
      :aria-label="t('common.filters.reset')"
      @click="filter = defaultArtifactFilters()"
    >
      <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
        t('common.filters.reset')
      }}</q-tooltip>
    </q-btn>
    <ArtifactFilterDialog
      v-model="open"
      v-model:filter="filter"
      :store-id="storeId"
      :tag-options="tagOptions"
    />
  </div>
</template>
