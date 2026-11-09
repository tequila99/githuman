<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AddButton from '@/components/buttons/AddButton.vue'
import CloseButton from '@/components/buttons/CloseButton.vue'
import ArtifactCatalogItem from '@/components/artifacts/ArtifactCatalogItem.vue'
import TaskArtifactPickerDialog from './TaskArtifactPickerDialog.vue'
import { useTaskArtifacts } from '@/composables/tasks/use-task-artifacts'
import type { ArtifactSearchItem } from '@/api/types'

const props = defineProps<{
  taskId: string
  storeId: string | null
  readonly: boolean
}>()
const { t } = useI18n()
const { items, error, busy, add, remove } = useTaskArtifacts(() => props.taskId)
const pickerOpen = shallowRef(false)
const filter = shallowRef('')
const filteredItems = computed(() => {
  const query = filter.value.trim().toLocaleLowerCase()
  return items.value.filter(item =>
    item.title.toLocaleLowerCase().includes(query)
  )
})
watch(
  () => props.taskId,
  () => {
    filter.value = ''
    pickerOpen.value = false
  }
)
function select(item: ArtifactSearchItem) {
  pickerOpen.value = false
  void add(item)
}
function route(item: { id: string }) {
  return {
    path: '/artifacts',
    query: { storeId: props.storeId ?? undefined, selectedId: item.id }
  }
}
</script>
<template>
  <section class="task-artifacts column no-wrap fit">
    <div class="task-artifacts__toolbar row items-center q-gutter-sm q-pa-md">
      <q-input
        outlined
        dense
        clearable
        class="col"
        :model-value="filter"
        :label="t('tasks.artifacts.searchWithinTask')"
        @update:model-value="filter = String($event ?? '')"
      />

      <AddButton
        v-if="!readonly"
        :loading="busy"
        :label="t('tasks.artifacts.add')"
        @click="pickerOpen = true"
      />
    </div>
    <div class="col scroll q-px-md q-pb-md">
      <div v-if="error" role="alert" class="text-negative">{{ error }}</div>
      <q-list v-if="filteredItems.length" role="list">
        <ArtifactCatalogItem
          v-for="item in filteredItems"
          :key="item.id"
          :item="item"
          :selected="false"
          :store-id="storeId"
          :to="route(item)"
        >
          <template v-if="!readonly" #side>
            <CloseButton
              size="sm"
              :disable="busy"
              :label="t('tasks.artifacts.removeHint')"
              :data-tooltip="t('tasks.artifacts.removeHint')"
              @click="remove(item)"
            />
          </template>
        </ArtifactCatalogItem>
      </q-list>
      <div v-else class="text-grey">{{
        t(
          items.length ? 'tasks.artifacts.noCandidates' : 'tasks.artifacts.none'
        )
      }}</div>
    </div>
    <TaskArtifactPickerDialog
      v-if="pickerOpen"
      v-model="pickerOpen"
      :store-id="storeId"
      @select="select"
    />
  </section>
</template>

<style scoped>
.task-artifacts {
  min-height: 0;
}
.task-artifacts__toolbar {
  flex-shrink: 0;
}
</style>
