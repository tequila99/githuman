<script setup lang="ts">
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import type { ArtifactSearchItem } from '@/api/types'
import CatalogListItem from '@/components/CatalogListItem.vue'
import { useArtifactDefinitionsStore } from '@/stores/artifact-definitions-store'
import { formatDateTime } from '@/utils/date'
import ArtifactStatusBadge from './ArtifactStatusBadge.vue'
import ArtifactTypeIcon from './ArtifactTypeIcon.vue'

// A bound artifact of a task has no search fields and no task list.
type CatalogItem = Pick<
  ArtifactSearchItem,
  'title' | 'status' | 'typeId' | 'createdAt'
> & { taskIds?: readonly string[] }

const props = defineProps<{
  item: CatalogItem
  selected: boolean
  storeId: string | null
  // The title becomes a link and the row stops being clickable.
  to?: RouteLocationRaw
}>()
defineEmits<{ select: [item: CatalogItem] }>()
const definitions = useArtifactDefinitionsStore()
const labels = computed(() =>
  props.storeId ? definitions.forStore(props.storeId) : null
)
const typeLabel = computed(
  () =>
    labels.value?.typeLabels.get(props.item.typeId)?.label ?? props.item.typeId
)
function taskLabel(id: string) {
  return labels.value?.taskLabels.get(id)?.title ?? id
}
</script>

<template>
  <CatalogListItem
    :title="item.title"
    :selected="selected"
    :to="to"
    :data-status="item.status"
    class="artifact-catalog__item"
    @click="$emit('select', item)"
  >
    <template #icon>
      <ArtifactTypeIcon
        :type-id="item.typeId"
        size="18px"
        class="artifact-catalog__icon"
      />
    </template>
    <template #metadata>
      <ArtifactStatusBadge :status="item.status" />
      <span class="artifact-catalog__type">{{ typeLabel }}</span>
      <time
        class="artifact-catalog__date"
        :datetime="item.createdAt"
        :title="item.createdAt"
        >{{ formatDateTime(item.createdAt) }}</time
      >
      <span
        v-for="taskId in item.taskIds ?? []"
        :key="taskId"
        class="artifact-catalog__task ellipsis"
        :title="taskLabel(taskId)"
        >{{ taskLabel(taskId) }}</span
      >
    </template>
    <template v-if="$slots.side" #side><slot name="side" /></template>
  </CatalogListItem>
</template>

<style scoped>
.artifact-catalog__item :deep(.catalog-list-item__metadata) {
  flex-wrap: nowrap;
  overflow: hidden;
  white-space: nowrap;
}
.artifact-catalog__item :deep(.q-badge) {
  flex-shrink: 0;
}
.artifact-catalog__type {
  flex: 0 0 auto;
  max-width: 100%;
  white-space: nowrap;
}
.artifact-catalog__task {
  min-width: 0;
  flex: 0 1 auto;
}
.artifact-catalog__date {
  flex: 0 0 auto;
}
.artifact-catalog__icon {
  color: inherit;
}
</style>
