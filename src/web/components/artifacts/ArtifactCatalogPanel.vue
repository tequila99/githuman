<script setup lang="ts">
import { computed, useTemplateRef, watch } from 'vue'
import type { QScrollArea } from 'quasar'
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
const scrollArea = useTemplateRef<QScrollArea>('catalogScroll')
const scrollTarget = computed(() => scrollArea.value?.getScrollTarget() ?? null)

async function loadMore(_index: number, done: () => void) {
  try {
    await store.loadMore()
  } finally {
    done()
  }
}
// A new search starts from the top of the list.
watch(
  () => props.searchKey,
  () => scrollArea.value?.setScrollPosition('vertical', 0)
)
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
      <SearchInput
        debounce="300"
        :model-value="query"
        :placeholder="t('artifacts.search')"
        :aria-label="t('artifacts.search')"
        @update:model-value="
          value => emit('update:query', value == null ? null : String(value))
        "
      />
    </div>
    <q-separator />
    <ArtifactStatusBanners
      :loading="store.loading"
      :error="store.error"
      :stale="store.stale"
      :partial="Boolean(store.catalog?.partial)"
    />
    <q-scroll-area
      ref="catalogScroll"
      class="col"
      content-style="width: 100%"
      content-active-style="width: 100%"
    >
      <q-infinite-scroll
        v-if="scrollTarget"
        :scroll-target="scrollTarget"
        :offset="300"
        :disable="
          store.loading || store.stale || !store.catalog?.nextCursor || !active
        "
        @load="loadMore"
      >
        <ArtifactCatalog
          :scroll-target="scrollTarget"
          :items="store.catalog?.items ?? []"
          :selected-id="selectedId"
          :grouping="filters.group"
          :store-id="store.storeId"
          @select="item => emit('select', item)"
        />
        <div
          v-if="!store.loading && !store.error && !store.catalog?.items.length"
          class="q-pa-md text-grey"
          >{{ t('artifacts.empty') }}</div
        >
        <template #loading>
          <div class="row justify-center q-pa-sm">
            <q-spinner color="primary" />
          </div>
        </template>
      </q-infinite-scroll>
    </q-scroll-area>
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
