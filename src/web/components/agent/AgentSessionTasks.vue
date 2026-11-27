<script setup lang="ts">
import { mdiClipboardTextOutline, mdiClose } from '@mdi/js'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useSessionTasks } from '@/composables/use-session-tasks'
import { useWorkspaceNavigation } from '@/composables/use-workspace-navigation'
import { describeSessionTask } from '@/utils/session-task-chip'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import AgentSessionTaskMenu from './AgentSessionTaskMenu.vue'

const props = defineProps<{ chatId: string; active: boolean }>()
const { t } = useI18n()
const router = useRouter()
const workspace = useWorkspaceNavigation()
const {
  model,
  storeId,
  localError,
  status,
  editable,
  labels,
  select,
  clear,
  save,
  reload
} = useSessionTasks(props)
const view = computed(() =>
  describeSessionTask(model.state.taskIds, id => labels.value?.get(id))
)
const href = computed(() =>
  view.value.id
    ? router.resolve('/tasks/' + encodeURIComponent(view.value.id)).href
    : undefined
)
const error = computed(() => localError.value || model.state.error)
const showError = computed(
  () =>
    error.value ||
    model.state.conflict ||
    (model.state.changed && model.state.dirty)
)
const canRetry = computed(
  () =>
    model.state.dirty &&
    !model.state.conflict &&
    (!model.state.changed || model.state.attempt !== null)
)
</script>

<template>
  <div class="agent-session-tasks row no-wrap items-center">
    <q-icon
      :name="mdiClipboardTextOutline"
      size="16px"
      class="app-icon-neutral agent-session-tasks__icon"
    />
    <div
      v-if="view.id"
      class="agent-session-tasks__selected row no-wrap items-center"
      :class="view.closed ? 'text-warning' : 'text-primary'"
    >
      <a
        :href="href"
        class="agent-session-tasks__link ellipsis"
        :title="view.title"
        @click.prevent="workspace.openTask(view.id)"
        >{{ view.title }}</a
      >
      <span v-if="view.extra > 0" class="agent-session-tasks__extra q-ml-xs">
        +{{ view.extra }}
      </span>
      <q-btn
        v-if="editable"
        flat
        dense
        round
        size="xs"
        class="app-icon-control agent-session-tasks__clear"
        :icon="mdiClose"
        :aria-label="t('agent.tasks.clear')"
        @click="clear"
      >
        <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
          t('agent.tasks.clear')
        }}</q-tooltip>
      </q-btn>
      <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
        status === 'ready' ? t('agent.tasks.hint') : t('agent.tasks.locked')
      }}</q-tooltip>
    </div>
    <AgentSessionTaskMenu
      v-else
      :store-id="storeId"
      :disabled="!editable"
      @select="select"
    />
    <q-spinner v-if="model.state.busy" size="14px" class="q-ml-xs" />
  </div>
  <div
    v-if="showError"
    role="alert"
    class="agent-session-tasks__error row items-center q-gutter-xs"
  >
    <span class="text-negative col ellipsis">{{
      error || t('agent.tasks.changed')
    }}</span>
    <q-btn
      v-if="canRetry"
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
</template>

<style scoped>
.agent-session-tasks {
  flex-shrink: 0;
  min-width: 0;
  min-height: 32px;
  padding: 0 8px;
  font-family: var(--font-agent);
  font-size: 12px;
  line-height: 1.4;
}
.agent-session-tasks__icon {
  flex-shrink: 0;
  margin-right: 6px;
}
.agent-session-tasks__selected {
  flex: 0 1 auto;
  min-width: 0;
}
.agent-session-tasks__extra,
.agent-session-tasks__clear {
  flex-shrink: 0;
}
.agent-session-tasks__link {
  display: block;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}
.agent-session-tasks__link:hover {
  text-decoration: underline;
}
.agent-session-tasks__error {
  padding: 0 8px 4px;
  font-family: var(--font-agent);
  font-size: 12px;
}
</style>
