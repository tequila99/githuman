<script setup lang="ts">
import { computed } from 'vue'
import ArtifactCatalogItem from './ArtifactCatalogItem.vue'
import VirtualInfiniteList from '@/components/VirtualInfiniteList.vue'
import { useI18n } from 'vue-i18n'
import { useArtifactDefinitionsStore } from '@/stores/artifact-definitions-store'
import { useAppTheme } from '@/composables/use-app-theme'
import type { ArtifactSearchItem } from '@/api/types'

const props = defineProps<{
  items: ArtifactSearchItem[]
  selectedId: string | undefined
  grouping: string
  storeId: string | null
  loading: boolean
  hasMore: boolean
  disabled: boolean
  searchKey: string
  loadMore: () => Promise<void>
}>()
defineEmits<{ select: [item: ArtifactSearchItem] }>()
const { t } = useI18n()
const { isDark } = useAppTheme()
const definitions = useArtifactDefinitionsStore()
function groupLabel(id: string) {
  if (!props.storeId) return id
  const labels = definitions.forStore(props.storeId)
  return props.grouping === 'type'
    ? (labels.typeLabels.get(id)?.label ?? id)
    : (labels.taskLabels.get(id)?.title ?? id)
}
const rows = computed(() => {
  const grouped = new Map<string, ArtifactSearchItem[]>()
  for (const item of props.items) {
    const keys =
      props.grouping === 'type'
        ? [item.typeId]
        : props.grouping === 'task'
          ? item.taskIds.length
            ? item.taskIds
            : ['']
          : ['']
    for (const key of keys) {
      const entries = grouped.get(key) ?? []
      entries.push(item)
      grouped.set(key, entries)
    }
  }
  return [...grouped].flatMap(([label, items]) => [
    ...(props.grouping === 'none'
      ? []
      : [{ kind: 'group' as const, key: `group:${label}`, label }]),
    ...items.map(item => ({
      kind: 'artifact' as const,
      key: `${label}:${item.id}`,
      item
    }))
  ])
})
</script>

<template>
  <VirtualInfiniteList
    :items="rows"
    :loading="loading"
    :has-more="hasMore"
    :disabled="disabled"
    :reset-key="searchKey"
    :load-more="loadMore"
    class="artifact-catalog artifact-summary"
    :class="{
      'artifact-summary--dark': isDark
    }"
  >
    <template #default="{ item: row }">
      <q-item-label
        v-if="row.kind === 'group'"
        :key="row.key"
        header
        class="artifact-catalog__group"
        :class="{ 'artifact-catalog__group--task': grouping === 'task' }"
      >
        {{ row.label ? groupLabel(row.label) : t('artifacts.noTask') }}
      </q-item-label>
      <ArtifactCatalogItem
        v-else
        :key="row.key"
        :item="row.item"
        :selected="row.item.id === selectedId"
        :store-id="storeId"
        @select="$emit('select', row.item)"
      />
    </template>
    <template #empty><slot name="empty" /></template>
  </VirtualInfiniteList>
</template>

<style scoped>
.artifact-catalog {
  min-width: 0;
}
.artifact-catalog__group {
  overflow-wrap: anywhere;
  padding: 10px 12px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: inherit;
  border-bottom: 1px solid var(--app-divider);
  background-color: rgba(128, 128, 128, 0.12);
}
.artifact-catalog__group--task {
  font-size: 13px;
  font-weight: 500;
}
</style>
