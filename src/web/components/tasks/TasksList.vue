<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AddButton from '@/components/buttons/AddButton.vue'
import RefreshButton from '@/components/buttons/RefreshButton.vue'
import SearchInput from '@/components/SearchInput.vue'
import VirtualInfiniteList from '@/components/VirtualInfiniteList.vue'
import type { TaskFilter } from '@/types/tasks'
import { useTasksStore } from '@/stores/tasks-store'
import TaskFilters from './TaskFilters.vue'
import TaskListItem from './TaskListItem.vue'

// Typing pauses this long before the server search starts.
const SEARCH_DEBOUNCE_MS = 300

defineProps<{ selectedId: string | null }>()
const emit = defineEmits<{ select: [id: string]; create: [] }>()
const { t } = useI18n()
const store = useTasksStore()
const filter = computed<TaskFilter>({
  get: () => ({
    state: store.state,
    tags: store.tags,
    tagMode: store.tagMode
  }),
  set: value => void store.setFilters(value)
})
const searchKey = computed(() => JSON.stringify([store.query, filter.value]))
const tagOptions = computed(() =>
  [...new Set(store.items.flatMap(task => task.tags))].sort((a, b) =>
    a.localeCompare(b)
  )
)

function setQuery(value: string | null | undefined) {
  void store.setFilters({ query: String(value ?? '').trim() })
}
</script>
<template>
  <section class="tasks-list column no-wrap fit">
    <div class="q-pa-sm">
      <div class="tasks-list__toolbar row items-center">
        <q-space />
        <AddButton :tooltip="t('tasks.new')" @click="emit('create')" />
        <RefreshButton
          :tooltip="t('tasks.refresh')"
          :loading="store.loading"
          @click="() => store.refresh()"
        />
        <TaskFilters v-model="filter" :tag-options="tagOptions" />
      </div>
      <SearchInput
        :debounce="SEARCH_DEBOUNCE_MS"
        :model-value="store.query"
        :placeholder="t('tasks.search')"
        :aria-label="t('tasks.search')"
        @update:model-value="setQuery"
      />
    </div>
    <q-separator />
    <q-banner v-if="store.error" dense class="text-negative">{{
      store.error
    }}</q-banner>
    <VirtualInfiniteList
      class="col"
      :items="store.items"
      :loading="store.loading"
      :has-more="Boolean(store.nextCursor)"
      :disabled="Boolean(store.error)"
      :reset-key="searchKey"
      :load-more="store.loadMore"
    >
      <template #default="{ item: task }">
        <TaskListItem
          :key="task.id"
          :task="task"
          :selected="task.id === selectedId"
          @select="item => emit('select', item.id)"
        />
      </template>
      <template #empty>
        <div v-if="!store.error" class="q-pa-md text-grey">{{
          t('tasks.empty')
        }}</div>
      </template>
    </VirtualInfiniteList>
  </section>
</template>
<style scoped>
.tasks-list {
  min-width: 0;
  min-height: 0;
}
</style>
