<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiAccountArrowRightOutline } from '@mdi/js'
import { useAgentStore } from '@/stores/agent-store'
import { useTaskHandoff } from '@/composables/tasks/use-task-handoff'
import { formatDateTime } from '@/utils/date'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import DialogButton from '@/components/buttons/DialogButton.vue'
import SubmitButton from '@/components/buttons/SubmitButton.vue'

const props = defineProps<{
  sourceSessionId: string
  disabled?: boolean
}>()
const { t } = useI18n()
const agent = useAgentStore()
const open = shallowRef(false)
const presetId = shallowRef('')
const name = shallowRef('')
const continuing = shallowRef(false)
const handoff = useTaskHandoff({
  sourceSessionId: () => props.sourceSessionId,
  async onReady(targetSessionId) {
    await agent.refreshSessions()
    agent.openChat(targetSessionId)
    open.value = false
  }
})
const { busy, error, slotsFull, operation } = handoff
const options = computed(() =>
  agent.presets
    .filter(p => p.available)
    .map(p => ({ label: p.title, value: p.id }))
)
const terminal = computed(
  () =>
    operation.value && ['failed', 'interrupted'].includes(operation.value.state)
)
async function show() {
  await agent.init()
  const source = agent.chats[props.sourceSessionId]?.info
  presetId.value =
    options.value.find(option => option.value === source?.presetId)?.value ??
    options.value[0]?.value ??
    ''
  name.value = source ? `${source.name} — continuation`.slice(0, 60) : ''
  handoff.reset()
  open.value = true
}
function close() {
  handoff.stop()
  open.value = false
}
async function continueWithoutPreview() {
  continuing.value = true
  try {
    await handoff.continueWithoutPreview(presetId.value, name.value)
  } finally {
    continuing.value = false
  }
}
</script>
<template>
  <q-btn
    round
    dense
    flat
    size="sm"
    class="app-icon-control q-ma-xs"
    :icon="mdiAccountArrowRightOutline"
    :aria-label="t('handoff.continue')"
    :disable="disabled || !agent.enabled"
    @click="show"
    ><q-tooltip :delay="TOOLTIP_DELAY_MS">{{
      t('handoff.continue')
    }}</q-tooltip></q-btn
  >
  <q-dialog
    v-model="open"
    :persistent="busy || operation?.state === 'preparing'"
    @hide="handoff.stop"
  >
    <q-card class="agent-handoff">
      <q-card-section class="text-h6">{{
        t('handoff.continue')
      }}</q-card-section>
      <q-card-section class="q-pt-none">
        <p>{{ t('handoff.sourceHint') }}</p>
        <q-input
          v-model="name"
          outlined
          dense
          :maxlength="60"
          :label="t('handoff.name')"
          :disable="!!operation || busy"
          class="q-mb-sm"
        />
        <q-select
          v-model="presetId"
          :options="options"
          emit-value
          map-options
          outlined
          dense
          :label="t('handoff.agent')"
          :disable="!!operation || busy"
        />
        <div v-if="operation && !continuing" class="q-mt-md"
          ><div class="text-caption"
            >{{ formatDateTime(operation.capturedAt) }} ·
            {{ t('handoff.states.' + operation.state) }}</div
          ><pre class="agent-handoff__snapshot">{{ operation.snapshot }}</pre>
        </div>
        <div
          v-if="error || operation?.error"
          role="alert"
          class="text-negative q-mt-sm"
          >{{ error || operation?.error }}</div
        >
        <div v-if="slotsFull" class="text-caption q-mt-xs">{{
          t('handoff.slotsFull')
        }}</div>
      </q-card-section>
      <q-card-actions align="right">
        <DialogButton
          :label="t('journal.cancel')"
          :disable="busy || operation?.state === 'preparing'"
          @click="close"
        />
        <DialogButton
          v-if="operation?.state === 'preview' || terminal"
          :label="t('journal.refresh')"
          :disable="busy"
          @click="handoff.reset"
        />
        <SubmitButton
          v-if="!operation || continuing"
          type="button"
          :label="t('handoff.withoutPreview')"
          :loading="continuing"
          :disable="!presetId || busy"
          @click="continueWithoutPreview"
        />
        <SubmitButton
          v-if="!operation"
          type="button"
          :label="t('handoff.preview')"
          :loading="busy"
          :disable="!presetId"
          @click="handoff.preview(presetId, name)"
        />
        <SubmitButton
          v-if="operation?.state === 'preview'"
          type="button"
          :label="t('handoff.create')"
          :loading="busy"
          @click="handoff.confirm"
        />
        <q-spinner v-if="operation?.state === 'preparing'" color="primary" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
<style scoped>
.agent-handoff {
  width: 700px;
  max-width: 95vw;
}
.agent-handoff__snapshot {
  max-height: 40vh;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
}
</style>
