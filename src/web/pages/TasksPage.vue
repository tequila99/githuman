<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppPage from '@/components/AppPage.vue'
import PanelResize from '@/components/PanelResize.vue'
import TaskCreateDialog from '@/components/tasks/TaskCreateDialog.vue'
import TaskPane from '@/components/tasks/TaskPane.vue'
import TasksList from '@/components/tasks/TasksList.vue'
import {
  enqueueWorkspaceNavigation,
  useWorkspaceNavigation
} from '@/composables/use-workspace-navigation'
import { useServerEvents } from '@/composables/use-server-events'
import { useTasksStore } from '@/stores/tasks-store'
import type { Task } from '@/api/types'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const store = useTasksStore()
const workspace = useWorkspaceNavigation()
const createOpen = shallowRef(false)
const selectedId = computed(() =>
  typeof route.params.id === 'string' ? route.params.id : null
)

function select(id: string) {
  void enqueueWorkspaceNavigation(router, () => ({
    path: '/tasks/' + encodeURIComponent(id),
    query: workspace.narrow.value
      ? { uiPane: 'content', uiWindow: undefined }
      : {}
  }))
}
async function created(task: Task) {
  await store.refresh()
  select(task.id)
}
const events = useServerEvents(['artifacts:changed'], () => {
  void store.refresh()
})
onMounted(() => void store.refresh())
onBeforeUnmount(() => events.close())
</script>
<template>
  <AppPage>
    <PanelResize
      class="fit"
      storage-key="githuman.tasksListWidth"
      :default-width="320"
    >
      <template #panel>
        <TasksList
          :selected-id="selectedId"
          @select="select"
          @create="createOpen = true"
        />
      </template>
      <template #content>
        <TaskPane v-if="selectedId" :key="selectedId" :task-id="selectedId" />
        <div v-else class="fit flex flex-center text-grey q-pa-lg">{{
          t('tasks.choose')
        }}</div>
      </template>
    </PanelResize>
    <TaskCreateDialog v-model="createOpen" @created="created" />
  </AppPage>
</template>
