<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import CancelButton from '@/components/buttons/CancelButton.vue'
import CloseButton from '@/components/buttons/CloseButton.vue'
import TextButton from '@/components/buttons/TextButton.vue'
import { errorMessage } from '@/utils/error-message'
import { hasValidationResult } from '@/utils/artifact-transition'
import { isTerminalTransitionStage } from '../../../shared/artifact-transitions/transitions.ts'
import ArtifactTransitionResult from './ArtifactTransitionResult.vue'
import { useArtifactTransitionStore } from '@/stores/artifact-transition-store'
import type { ArtifactTransitionOperation } from '@/api/types'

const props = defineProps<{ operation: ArtifactTransitionOperation }>()
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()
const store = useArtifactTransitionStore()
const cancelError = ref<string | null>(null)
const busy = ref(false)
const resultOpen = ref(false)
const finished = computed(() =>
  isTerminalTransitionStage(props.operation.stage)
)
const label = computed(() =>
  props.operation.cancelRequested && !finished.value
    ? t('artifacts.transition.cancelRequested')
    : t('artifacts.transition.stages.' + props.operation.stage)
)
const retryable = computed(
  () => finished.value && props.operation.stage !== 'succeeded'
)

// A cancel error belongs to one operation and one stage.
watch([() => props.operation.id, () => props.operation.stage], () => {
  cancelError.value = null
})

async function cancel() {
  busy.value = true
  cancelError.value = null
  try {
    await store.cancel(props.operation.artifactId, props.operation.id)
  } catch (error) {
    cancelError.value = errorMessage(error)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div
    class="artifact-transition-progress row items-center no-wrap q-gutter-x-sm"
    role="status"
    aria-live="polite"
    :aria-label="
      t('artifacts.transition.progressLabel', {
        to: t('artifacts.statuses.' + operation.targetStatus)
      })
    "
  >
    <q-spinner v-if="!finished" size="1em" />
    <span class="text-caption">{{ label }}</span>
    <span v-if="operation.reason" class="text-caption text-negative">{{
      operation.reason
    }}</span>
    <span v-if="cancelError" class="text-caption text-negative">{{
      cancelError
    }}</span>
    <CancelButton
      v-if="operation.canCancel && !operation.cancelRequested"
      no-caps
      size="sm"
      :loading="busy"
      @click="cancel"
    />
    <TextButton
      v-if="finished && hasValidationResult(operation)"
      :label="t('artifacts.transition.result')"
      @click="resultOpen = true"
    />
    <ArtifactTransitionResult v-model="resultOpen" :operation="operation" />
    <TextButton
      v-if="retryable"
      :label="t('artifacts.transition.retry')"
      @click="emit('retry')"
    />
    <CloseButton
      v-if="finished"
      size="sm"
      :label="t('artifacts.transition.dismiss')"
      @click="store.dismiss(operation.artifactId)"
    />
  </div>
</template>
