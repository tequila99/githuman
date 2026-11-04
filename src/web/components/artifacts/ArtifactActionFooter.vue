<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import DialogButton from '@/components/buttons/DialogButton.vue'
import SaveButton from '@/components/buttons/SaveButton.vue'
import type { ArtifactActionInspection } from '@/api/types'
import type { ArtifactActionAvailability } from '@/utils/artifact-action-state'

defineProps<{
  phase: ArtifactActionInspection['phase']
  busy: boolean
  availability: ArtifactActionAvailability
  confirmed: boolean
  confirmDisabled: boolean
}>()
const emit = defineEmits<{
  (e: 'refresh' | 'reject' | 'apply' | 'approve'): void
  (e: 'confirm', value: boolean): void
}>()
const { t } = useI18n()
</script>

<template>
  <q-card-actions class="artifact-action-footer">
    <!-- The box sits next to the button it unlocks. -->
    <q-checkbox
      v-if="phase === 'pending'"
      :model-value="confirmed"
      class="artifact-action-footer__confirm"
      :disable="confirmDisabled"
      :label="t('artifacts.actions.confirmScope')"
      @update:model-value="value => emit('confirm', value)"
    />
    <q-space />
    <DialogButton
      :label="t('artifacts.actions.refreshScope')"
      :disable="busy"
      @click="emit('refresh')"
    />
    <DialogButton
      v-if="phase !== 'consumed'"
      color="negative"
      :label="t('artifacts.actions.reject')"
      :disable="busy"
      @click="emit('reject')"
    />
    <DialogButton
      v-if="availability.canExecute"
      :label="t('artifacts.actions.apply')"
      @click="emit('apply')"
    />
    <SaveButton
      v-if="phase === 'pending'"
      :label="t('artifacts.actions.approve')"
      :disable="!availability.canApprove"
      :loading="busy"
      @click="emit('approve')"
    />
  </q-card-actions>
</template>

<style scoped>
.artifact-action-footer {
  flex-wrap: wrap;
  justify-content: flex-end;
}
/* The label may wrap: on a narrow card the box takes a row of its own. */
.artifact-action-footer__confirm {
  flex: 1 1 21rem;
  min-width: 0;
}
</style>
