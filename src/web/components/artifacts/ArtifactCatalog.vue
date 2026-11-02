<script setup lang="ts">
import { computed } from 'vue'
import ArtifactCatalogItem from './ArtifactCatalogItem.vue'
import { useI18n } from 'vue-i18n'
import { useArtifactDefinitionsStore } from '@/stores/artifact-definitions-store'
import { useAppTheme } from '@/composables/use-app-theme'
import type { ArtifactSearchItem } from '@/api/types'

// Match the regular catalog row before Quasar measures its actual height.
const ROW_HEIGHT_ESTIMATE = 60

const props = defineProps<{
  items: ArtifactSearchItem[]
  selectedId: string | undefined
  grouping: string
  storeId: string | null
  scrollTarget: Element
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
  <q-virtual-scroll
    :items="rows"
    :scroll-target="scrollTarget"
    :virtual-scroll-item-size="ROW_HEIGHT_ESTIMATE"
    class="artifact-catalog artifact-summary"
    :class="{
      'artifact-summary--dark': isDark
    }"
    role="list"
  >
    <template #default="{ item: row }">
      <q-item-label
        v-if="row.kind === 'group'"
        :key="row.key"
        header
        class="artifact-catalog__group"
      >
        {{ row.label ? groupLabel(row.label) : t('artifacts.noTask') }}
      </q-item-label>
      <ArtifactCatalogItem
        v-else
        :key="row.key"
        :item="row.item"
        :selected="row.item.id === selectedId"
        :store-id="storeId"
        @select="$emit('select', $event)"
      />
    </template>
  </q-virtual-scroll>
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
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
  background-color: rgba(128, 128, 128, 0.12);
}
</style>
