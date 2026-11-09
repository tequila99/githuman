<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownEditor from '@/components/markdown/MarkdownEditor.vue'
import { useTaskEditor } from '@/composables/tasks/use-task-editor'
import { useTaskLinkSource } from '@/composables/tasks/use-task-link-source'
import { useTasksStore } from '@/stores/tasks-store'
import TaskPaneHeader from './TaskPaneHeader.vue'
import TaskArtifactsPanel from './TaskArtifactsPanel.vue'
import TaskCloseDialog from './TaskCloseDialog.vue'

const props = defineProps<{ taskId: string }>()
const { t } = useI18n()
const tasks = useTasksStore()
const linkSource = useTaskLinkSource()
const editor = useTaskEditor(() => props.taskId)
const { task, draft, status } = editor
const tab = shallowRef<'description' | 'artifacts'>('description')
const closeOpen = shallowRef(false)
const closing = shallowRef(false)
const closeError = shallowRef<string | null>(null)
const artifactCount = computed(
  () => tasks.items.find(item => item.id === props.taskId)?.artifactCount
)
const readonly = computed(() => task.value?.state === 'closed')
async function confirmClose() {
  closing.value = true
  closeError.value = null
  const done = await editor.close()
  closing.value = false
  if (done) {
    closeOpen.value = false
    void tasks.refresh()
  } else {
    closeError.value = editor.error.value
  }
}
// Pending edits are saved first; a reload would replace them.
async function reload() {
  await editor.save()
  await editor.load()
}
</script>
<template>
  <section class="task-pane column no-wrap fit">
    <div v-if="editor.loading.value && !task" class="q-pa-lg text-grey">{{
      t('tasks.loading')
    }}</div>
    <div v-else-if="!task" role="alert" class="q-pa-lg text-negative">{{
      editor.error.value
    }}</div>
    <template v-else>
      <TaskPaneHeader
        :task="task"
        :draft="draft"
        :status="status"
        :error="editor.error.value"
        :loading="editor.loading.value"
        @edit="editor.edit"
        @close="closeOpen = true"
        @reload="reload"
        @discard="editor.load"
      />
      <q-tabs
        v-model="tab"
        dense
        no-caps
        align="left"
        class="task-pane__tabs"
        active-color="primary"
      >
        <q-tab name="description" :label="t('tasks.description')" />
        <q-tab name="artifacts">
          <div class="row items-center no-wrap q-gutter-x-sm">
            <span>{{ t('tasks.artifacts.tab') }}</span>
            <q-badge
              v-if="artifactCount !== undefined"
              color="grey-7"
              :label="artifactCount"
              :aria-label="t('tasks.artifacts.count', { count: artifactCount })"
            />
          </div>
        </q-tab>
      </q-tabs>
      <q-separator />
      <q-tab-panels v-model="tab" keep-alive class="task-pane__panels col">
        <q-tab-panel name="description" class="q-pa-md">
          <MarkdownEditor
            :key="editor.revision.value"
            :model-value="draft.description"
            :source="linkSource"
            :readonly="readonly"
            @update:model-value="description => editor.edit({ description })"
            @follow="linkSource.follow"
          />
        </q-tab-panel>
        <q-tab-panel name="artifacts" class="task-pane__artifacts q-pa-none">
          <TaskArtifactsPanel
            :task-id="task.id"
            :store-id="task.storeId"
            :readonly="readonly"
          />
        </q-tab-panel>
      </q-tab-panels>
    </template>
    <TaskCloseDialog
      v-model="closeOpen"
      :task-id="props.taskId"
      :busy="closing"
      :error="closeError"
      @confirm="confirmClose"
    />
  </section>
</template>
<style scoped>
.task-pane {
  min-width: 0;
  min-height: 0;
}
.task-pane__artifacts {
  height: 100%;
  overflow: hidden;
}
.task-pane__panels {
  min-height: 0;
  background: transparent;
}
</style>
