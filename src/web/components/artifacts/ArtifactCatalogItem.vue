<script setup lang="ts">
import { computed } from 'vue'
import type { ArtifactSearchItem } from '@/api/types'
import { useAppTheme } from '@/composables/use-app-theme'
import { useArtifactDefinitionsStore } from '@/stores/artifact-definitions-store'
import { formatDateTime } from '@/utils/date'
import ArtifactStatusBadge from './ArtifactStatusBadge.vue'
import ArtifactTypeIcon from './ArtifactTypeIcon.vue'

const props = defineProps<{
  item: ArtifactSearchItem
  selected: boolean
  storeId: string | null
}>()
defineEmits<{ select: [item: ArtifactSearchItem] }>()
const { isDark } = useAppTheme()
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
  <q-item
    role="listitem"
    :data-status="item.status"
    clickable
    :dark="isDark"
    class="artifact-catalog__item"
    :active="selected"
    :aria-current="selected ? 'true' : undefined"
    @click="$emit('select', item)"
  >
    <q-item-section side class="artifact-catalog__side">
      <ArtifactTypeIcon
        :type-id="item.typeId"
        size="18px"
        class="artifact-catalog__icon"
      />
    </q-item-section>
    <q-item-section class="artifact-catalog__main">
      <q-item-label
        class="artifact-summary__title artifact-catalog__title ellipsis"
        :title="item.title"
        >{{ item.title }}</q-item-label
      >
      <q-item-label
        caption
        class="artifact-summary__caption artifact-catalog__metadata"
      >
        <ArtifactStatusBadge :status="item.status" />
        <span class="artifact-catalog__type ellipsis" :title="typeLabel">{{
          typeLabel
        }}</span>
        <time
          class="artifact-catalog__date"
          :datetime="item.createdAt"
          :title="item.createdAt"
          >{{ formatDateTime(item.createdAt) }}</time
        >
        <span
          v-for="taskId in item.taskIds"
          :key="taskId"
          class="artifact-catalog__task ellipsis"
          :title="taskLabel(taskId)"
          >{{ taskLabel(taskId) }}</span
        >
      </q-item-label>
    </q-item-section>
  </q-item>
</template>

<style scoped>
.artifact-catalog__item {
  min-width: 0;
  min-height: 60px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
}
.artifact-catalog__item.q-item--active {
  color: inherit;
  box-shadow: inset 3px 0 var(--q-primary);
  background-image: linear-gradient(
    rgba(25, 118, 210, 0.1),
    rgba(25, 118, 210, 0.1)
  );
}
.artifact-catalog__item:focus-visible {
  outline: 2px solid var(--q-primary);
  outline-offset: -2px;
}
.artifact-catalog__side {
  min-width: 0;
  padding-right: 10px;
}
.artifact-catalog__main {
  min-width: 0;
}
.artifact-catalog__title.ellipsis {
  white-space: nowrap;
  overflow-wrap: normal;
}
.artifact-catalog__metadata {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
  white-space: nowrap;
}
.artifact-catalog__type {
  min-width: 0;
  flex: 0 1 auto;
}
.artifact-catalog__task {
  min-width: 0;
  flex: 0 1 auto;
}
.artifact-catalog__date {
  flex: 0 0 auto;
}
.artifact-catalog__icon {
  color: var(--app-icon-neutral);
}
.artifact-catalog__item.q-item--active .artifact-catalog__icon {
  color: var(--q-primary);
}
</style>
