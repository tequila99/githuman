<script setup lang="ts">
import { mdiClipboardTextOutline } from '@mdi/js'
import { shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSessionTasks } from '@/composables/use-session-tasks'
import AgentSessionTaskPicker from './AgentSessionTaskPicker.vue'
import AgentSessionTaskChip from './AgentSessionTaskChip.vue'

const props = defineProps<{ chatId: string; active: boolean }>()
const { t } = useI18n()
const selected = shallowRef<string | null>(null)
const {
  model,
  open,
  storeId,
  localError,
  info,
  canEdit,
  labels,
  inheritanceHint,
  add,
  remove,
  save,
  reload
} = useSessionTasks(props)
</script>
<template>
  <q-expansion-item
    v-model="open"
    dense
    dense-toggle
    class="agent-session-tasks app-icon-expansion"
    header-class="agent-session-tasks__header"
  >
    <template #header>
      <q-item-section side class="agent-session-tasks__icon">
        <q-icon
          :name="mdiClipboardTextOutline"
          size="16px"
          class="app-icon-neutral"
        />
      </q-item-section>
      <q-item-section>
        {{ t('agent.tasks.title', { count: info?.taskIds?.length ?? 0 }) }}
      </q-item-section>
    </template>
    <div v-if="open" class="agent-session-tasks__body">
      <q-linear-progress
        v-if="model.state.loading || model.state.busy"
        indeterminate
      />
      <div
        v-if="localError || model.state.error"
        role="alert"
        class="text-negative"
        >{{ localError || model.state.error }}</div
      >
      <q-banner
        v-if="model.state.changed || model.state.conflict"
        dense
        class="agent-session-tasks__notice"
        >{{ t('agent.tasks.changed') }}</q-banner
      >
      <div class="agent-session-tasks__hint" role="status">
        {{ inheritanceHint }}
        <div v-if="info?.status === 'busy'">{{
          t('agent.tasks.nextTurn')
        }}</div>
      </div>
      <AgentSessionTaskPicker
        v-model="selected"
        v-if="storeId && canEdit"
        :store-id="storeId"
        :disable="
          model.state.busy ||
          model.state.loading ||
          model.state.dirty ||
          !model.state.base
        "
        @add="add"
      />
      <div class="row q-gutter-xs">
        <AgentSessionTaskChip
          v-for="id in model.state.taskIds"
          :key="id"
          :id="id"
          :task="labels?.get(id)"
          :removable="
            Boolean(
              canEdit &&
              !model.state.busy &&
              !model.state.loading &&
              !model.state.dirty
            )
          "
          @remove="remove(id)"
        />
      </div>
      <div
        v-if="
          localError ||
          model.state.error ||
          model.state.conflict ||
          (model.state.changed && model.state.dirty)
        "
        class="row q-gutter-sm"
      >
        <q-btn
          v-if="
            model.state.dirty &&
            !model.state.conflict &&
            (!model.state.changed || model.state.attempt !== null)
          "
          flat
          dense
          size="sm"
          :label="t('agent.tasks.retry')"
          :loading="model.state.busy"
          @click="save"
        />
        <q-btn
          flat
          dense
          size="sm"
          :label="t('agent.tasks.reload')"
          :disable="model.state.busy"
          @click="reload"
        />
      </div>
    </div>
  </q-expansion-item>
</template>
<style scoped>
.agent-session-tasks {
  flex-shrink: 0;
  min-width: 0;
  font-family: var(--font-agent);
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.agent-session-tasks :deep(.agent-session-tasks__header) {
  min-height: 32px;
  padding: 4px 8px;
  font-size: inherit;
}
.agent-session-tasks__icon {
  padding-right: 6px;
}
.agent-session-tasks__body {
  max-height: 35vh;
  overflow-y: auto;
  padding: 0 8px 8px;
}
.agent-session-tasks__hint {
  margin: 4px 0 8px;
  color: var(--app-icon-neutral);
}
.agent-session-tasks__notice,
.agent-session-tasks :deep(.q-field),
.agent-session-tasks :deep(.q-field__label),
.agent-session-tasks :deep(.q-field__bottom) {
  font-family: inherit;
  font-size: 12px;
  line-height: 1.4;
}
</style>
