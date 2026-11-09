<script setup lang="ts">
import { mdiSourceBranch } from '@mdi/js'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import { useI18n } from 'vue-i18n'
import SearchInput from '@/components/SearchInput.vue'
import RefreshButton from '@/components/buttons/RefreshButton.vue'
import { useArtifactsStore } from '@/stores/artifacts-store'
import type { ArtifactSearchItem } from '@/api/types'
import type { ArtifactCatalogFilters } from '@/types/artifacts'
import ArtifactCatalog from './ArtifactCatalog.vue'
import ArtifactFilters from './ArtifactFilters.vue'
import ArtifactStatusBanners from './ArtifactStatusBanners.vue'

const props = defineProps<{
  filters: ArtifactCatalogFilters
  query: string | null
  selectedId: string | undefined
  searchKey: string
  navigationKey: string
  tagOptions: string[]
  active: boolean
}>()
const emit = defineEmits<{
  'update:filters': [filters: ArtifactCatalogFilters]
  'update:query': [query: string | null]
  select: [item: ArtifactSearchItem]
}>()
const { t } = useI18n()
const store = useArtifactsStore()
</script>

<template>
  <section class="artifact-catalog-panel column no-wrap fit">
    <div class="q-pa-sm">
      <div class="artifact-catalog-panel__toolbar row items-center">
        <q-space />
        <RefreshButton
          :tooltip="t('artifacts.refresh')"
          :loading="store.loading"
          @click="() => store.reload()"
        />
        <ArtifactFilters
          :model-value="filters"
          :store-id="store.storeId"
          :navigation-key="navigationKey"
          :tag-options="tagOptions"
          @update:model-value="value => emit('update:filters', value)"
        />
      </div>
      <div class="row no-wrap items-center q-gutter-x-xs">
        <SearchInput
          class="col"
          debounce="300"
          :model-value="query"
          :placeholder="t('artifacts.search')"
          :aria-label="t('artifacts.search')"
          @update:model-value="
            value => emit('update:query', value == null ? null : String(value))
          "
        />
        <q-btn
          class="app-icon-control"
          flat
          dense
          round
          size="sm"
          :icon="mdiSourceBranch"
          :color="filters.group === 'task' ? 'primary' : undefined"
          :aria-label="t('artifacts.groupByTask')"
          :aria-pressed="filters.group === 'task'"
          @click="
            emit('update:filters', {
              ...filters,
              group: filters.group === 'task' ? 'none' : 'task'
            })
          "
        >
          <q-tooltip :delay="TOOLTIP_DELAY_MS">
            {{ t('artifacts.groupByTask') }}
          </q-tooltip>
        </q-btn>
      </div>
    </div>
    <q-separator />
    <ArtifactStatusBanners
      :loading="store.loading"
      :error="store.error"
      :stale="store.stale"
      :partial="Boolean(store.catalog?.partial)"
    />
    <ArtifactCatalog
      class="col"
      :items="store.catalog?.items ?? []"
      :selected-id="selectedId"
      :grouping="filters.group"
      :store-id="store.storeId"
      :loading="store.loading"
      :has-more="Boolean(store.catalog?.nextCursor)"
      :disabled="store.stale || Boolean(store.error) || !active"
      :search-key="searchKey"
      :load-more="store.loadMore"
      @select="item => emit('select', item)"
    >
      <template #empty>
        <div v-if="!store.error" class="q-pa-md text-grey">{{
          t('artifacts.empty')
        }}</div>
      </template>
    </ArtifactCatalog>
  </section>
</template>

<style scoped>
.artifact-catalog-panel {
  min-width: 0;
  min-height: 0;
}
.artifact-catalog-panel__toolbar :deep(.q-btn) {
  color: #757575;
}
.body--dark .artifact-catalog-panel__toolbar :deep(.q-btn) {
  color: #bdbdbd;
}
.artifact-catalog-panel__toolbar :deep(.q-btn .q-icon) {
  font-size: 20px;
}
</style>
