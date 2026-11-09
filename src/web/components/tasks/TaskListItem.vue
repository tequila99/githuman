<script setup lang="ts">
import { mdiClipboardTextOutline } from '@mdi/js'
import { useI18n } from 'vue-i18n'
import CatalogListItem from '@/components/CatalogListItem.vue'
import type { Task, TaskList } from '@/api/types'
import { formatDateTime } from '@/utils/date'
import TaskStateBadge from './TaskStateBadge.vue'

defineProps<{ task: TaskList['items'][number]; selected: boolean }>()
defineEmits<{ select: [task: Task] }>()
const { t } = useI18n()
</script>

<template>
  <CatalogListItem
    :title="task.title"
    :selected="selected"
    :data-state="task.state"
    class="task-list__item"
    @click="$emit('select', task)"
  >
    <template #icon>
      <q-icon :name="mdiClipboardTextOutline" size="18px">
        <q-badge
          v-if="task.artifactCount > 0"
          floating
          color="grey-7"
          class="app-icon-badge"
          :title="t('tasks.artifacts.count', { count: task.artifactCount })"
          :aria-label="
            t('tasks.artifacts.count', { count: task.artifactCount })
          "
          >{{ task.artifactCount }}</q-badge
        >
      </q-icon>
    </template>
    <template #metadata>
      <TaskStateBadge :state="task.state" />
      <time
        class="task-list__date"
        :datetime="task.createdAt"
        :title="task.createdAt"
        >{{ formatDateTime(task.createdAt) }}</time
      >
      <span
        v-for="tag in task.tags"
        :key="tag"
        class="task-list__tag ellipsis"
        :title="tag"
        >{{ tag }}</span
      >
    </template>
  </CatalogListItem>
</template>

<style scoped>
.task-list__item :deep(.catalog-list-item__icon) {
  padding-right: 16px;
}
.task-list__date {
  flex: 0 0 auto;
}
.task-list__tag {
  min-width: 0;
  flex: 0 1 auto;
}
</style>
