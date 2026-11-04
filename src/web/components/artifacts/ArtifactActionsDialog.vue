<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import DialogHeader from '@/components/DialogHeader.vue'
import TextButton from '@/components/buttons/TextButton.vue'
import ArtifactActionDetail from '@/components/artifacts/ArtifactActionDetail.vue'
import ArtifactActionFooter from '@/components/artifacts/ArtifactActionFooter.vue'
import ArtifactActionQueueList from '@/components/artifacts/ArtifactActionQueueList.vue'
import { clampWidth, readStoredWidth } from '@/composables/use-panel-width'
import { useWorkspaceNavigation } from '@/composables/use-workspace-navigation'
import type { ArtifactActionsModel } from '@/stores/artifact-actions-store'
import { actionAvailability } from '@/utils/artifact-action-state'
import { isFiniteNumber } from '@/utils/guards'
import { safeStorage } from '@/utils/safe-storage'

// Where the width of the request list is remembered between page loads.
const LIST_WIDTH_KEY = 'githuman.artifactActionsListWidth'
// Narrowest and widest request list the user can drag to, in pixels.
const LIST_MIN_WIDTH = 200
const LIST_MAX_WIDTH = 420
const LIST_DEFAULT_WIDTH = 280
const LIST_LIMITS = [LIST_MIN_WIDTH, LIST_MAX_WIDTH]

const props = defineProps<{
  model: ArtifactActionsModel | null
  loading: boolean
  error: string | null
}>()
const emit = defineEmits<{ (e: 'retry'): void }>()
const open = defineModel<boolean>({ required: true })
const { t } = useI18n()
const workspace = useWorkspaceNavigation()

const listWidth = ref(
  readStoredWidth(LIST_WIDTH_KEY, LIST_MIN_WIDTH, LIST_MAX_WIDTH) ??
    LIST_DEFAULT_WIDTH
)

const state = computed(() => props.model?.state ?? null)
const inspection = computed(() => state.value?.inspection ?? null)
const busy = computed(() => state.value?.busy ?? false)
const availability = computed(() =>
  actionAvailability(state.value, inspection.value)
)
const narrow = computed(() => workspace.narrow.value)
// A narrow screen shows the list or the detail, one at a time.
const detailShown = computed(() => Boolean(state.value?.selectedId))

watch(open, value => {
  // Hiding the dialog drops the selection and with it any confirmation.
  if (!value) void props.model?.select(null)
})

/** A short drag can report `undefined`; check the value before it reaches the model. */
function onListWidth(next: number | undefined) {
  if (narrow.value || !isFiniteNumber(next)) return
  listWidth.value = clampWidth(next, LIST_MIN_WIDTH, LIST_MAX_WIDTH)
  safeStorage.set(LIST_WIDTH_KEY, String(listWidth.value))
}

async function run(action: () => Promise<unknown>) {
  try {
    await action()
  } catch {
    // The store keeps the message in its state; this stops an unhandled rejection.
  }
}
</script>

<template>
  <q-dialog v-model="open" :persistent="busy" :maximized="narrow">
    <q-card
      class="column no-wrap"
      :class="{ 'artifact-actions-dialog': !narrow }"
    >
      <DialogHeader
        :title="t('artifacts.actions.queueTitle')"
        :close-label="t('artifacts.actions.queueClose')"
        :disable-close="busy"
      />
      <q-card-section v-if="error && !model" class="text-negative" role="alert">
        {{ t('artifacts.actions.queueLoadFailed') }}: {{ error }}
        <TextButton
          :label="t('artifacts.actions.queueRetry')"
          @click="emit('retry')"
        />
      </q-card-section>
      <q-card-section v-else-if="loading && !model">
        <q-spinner />
      </q-card-section>
      <q-splitter
        v-else-if="model && state"
        :model-value="listWidth"
        :limits="LIST_LIMITS"
        unit="px"
        class="col artifact-actions-dialog__body"
        :class="{ 'artifact-actions-dialog__body--narrow': narrow }"
        :disable="narrow"
        :before-class="[
          'artifact-actions-dialog__side',
          { 'artifact-actions-dialog__hidden': narrow && detailShown }
        ]"
        :after-class="[
          'artifact-actions-dialog__side',
          'artifact-actions-dialog__pane',
          { 'artifact-actions-dialog__hidden': narrow && !detailShown }
        ]"
        @update:model-value="onListWidth"
      >
        <template #before>
          <ArtifactActionQueueList
            class="fit"
            :items="state.items"
            :selected-id="state.selectedId"
            :disabled="busy"
            :list-error="state.listError"
            @pick="id => run(() => model!.select(id))"
            @refresh="run(() => model!.list())"
          />
        </template>
        <template #after>
          <ArtifactActionDetail
            :model="model"
            :narrow="narrow"
            :availability="availability"
            @back="run(() => model!.select(null))"
            @refresh="run(() => model!.refresh())"
          />
        </template>
      </q-splitter>
      <ArtifactActionFooter
        v-if="model && inspection"
        :phase="inspection.phase"
        :busy="busy"
        :availability="availability"
        :confirmed="state?.confirmed ?? false"
        :confirm-disabled="busy || (state?.stale ?? true) || !inspection.ready"
        @confirm="value => model!.confirm(value)"
        @refresh="run(() => model!.invalidate())"
        @reject="run(() => model!.revoke())"
        @apply="run(() => model!.execute())"
        @approve="run(() => model!.approve())"
      />
    </q-card>
  </q-dialog>
</template>

<style scoped>
/* A fixed size: the dialog must not jump with the list or with the open request. */
.artifact-actions-dialog {
  width: min(52rem, 96vw);
  height: min(43rem, 92vh);
  max-width: none;
  max-height: none;
}
.artifact-actions-dialog__body {
  min-height: 0;
}
:deep(.artifact-actions-dialog__side) {
  min-width: 0;
  min-height: 0;
}
:deep(.artifact-actions-dialog__pane) {
  overflow-y: auto;
}
/* A narrow screen shows one pane at a time: the splitter gives it the full width. */
.artifact-actions-dialog__body--narrow :deep(.q-splitter__separator) {
  display: none;
}
.artifact-actions-dialog__body--narrow :deep(.q-splitter__before),
.artifact-actions-dialog__body--narrow :deep(.q-splitter__after) {
  width: 100% !important;
}
:deep(.artifact-actions-dialog__hidden) {
  display: none;
}
</style>
