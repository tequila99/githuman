<script setup lang="ts">
import { mdiContentCopy } from '@mdi/js'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { copyToClipboard, useQuasar } from 'quasar'
import type { Task } from '@/api/types'
import type { TaskEditStatus } from '@/composables/tasks/use-task-editor'
import AddToAgentButton from '@/components/buttons/AddToAgentButton.vue'
import RefreshButton from '@/components/buttons/RefreshButton.vue'
import DialogButton from '@/components/buttons/DialogButton.vue'
import NoteTags from '@/components/notes/NoteTags.vue'
import { useTasksStore } from '@/stores/tasks-store'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import TaskTitleEditor from './TaskTitleEditor.vue'
import TaskStatusButton from './TaskStatusButton.vue'
import TaskLinksEditor from './TaskLinksEditor.vue'

type HeaderDraft = Pick<Task, 'title' | 'tags' | 'links'>
const props = defineProps<{
  task: Task
  draft: HeaderDraft
  status: TaskEditStatus
  error: string | null
  loading: boolean
}>()
const emit = defineEmits<{
  edit: [patch: Partial<HeaderDraft>]
  close: []
  reload: []
  discard: []
}>()
const { t } = useI18n()
const $q = useQuasar()
const tasks = useTasksStore()
const readonly = computed(() => props.task.state === 'closed')
// Tags from the loaded task list also allow newly typed values.
const tagOptions = computed(() => [
  ...new Set(tasks.items.flatMap(item => item.tags))
])
const statusLabel = computed(() =>
  props.error === 'empty-title'
    ? t('tasks.status.emptyTitle')
    : t('tasks.status.' + props.status)
)
function copyId() {
  void copyToClipboard(props.task.id).then(() =>
    $q.notify({ type: 'positive', message: t('tasks.idCopied') })
  )
}
</script>

<template>
  <div class="task-pane__head q-pa-md scroll">
    <TaskTitleEditor
      :key="task.id"
      :title="draft.title"
      :readonly="readonly"
      @update:title="title => emit('edit', { title })"
    />
    <div class="row items-center q-gutter-sm">
      <TaskStatusButton :state="task.state" @close="emit('close')" />
      <div class="row items-center q-gutter-x-sm text-caption text-grey">
        <code>{{ task.id }}</code>
        <q-btn
          flat
          round
          dense
          size="sm"
          class="app-icon-control"
          :icon="mdiContentCopy"
          :aria-label="t('tasks.copyId')"
          @click="copyId"
        >
          <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
            t('tasks.copyId')
          }}</q-tooltip>
        </q-btn>
      </div>
      <q-space />
      <span
        role="status"
        class="text-caption text-grey"
        :class="{
          'text-negative': status === 'error' || status === 'conflict'
        }"
        >{{ statusLabel }}</span
      >
      <AddToAgentButton
        :dense="false"
        :label="t('tasks.addToAgent')"
        :context="{
          kind: 'task',
          storeId: task.storeId,
          taskId: task.id,
          name: task.title
        }"
      />
      <RefreshButton
        :dense="false"
        :loading="loading"
        :tooltip="t('tasks.refresh')"
        @click="emit('reload')"
      />
    </div>
    <NoteTags
      hide-bottom-space
      allow-create
      :disabled="readonly"
      :model-value="draft.tags"
      :options="tagOptions"
      @update:model-value="tags => emit('edit', { tags })"
    />
    <q-banner
      v-if="status === 'conflict'"
      dense
      class="bg-warning text-black q-mt-sm"
    >
      {{ t('tasks.status.conflictHint') }}
      <template #action>
        <DialogButton :label="t('tasks.reload')" @click="emit('discard')" />
      </template>
    </q-banner>
    <div
      v-else-if="status === 'error' && error !== 'empty-title'"
      role="alert"
      class="text-negative q-mt-sm"
      >{{ error }}</div
    >
    <TaskLinksEditor
      class="q-mt-md"
      :links="draft.links"
      :readonly="readonly"
      @update:links="links => emit('edit', { links })"
    />
  </div>
</template>

<style scoped>
/* The header scrolls on its own, so the tab panels keep most of the height. */
.task-pane__head {
  flex: 0 1 auto;
  max-height: 50%;
}
</style>
