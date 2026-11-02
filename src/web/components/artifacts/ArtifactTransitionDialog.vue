<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import DialogHeader from '@/components/DialogHeader.vue'
import TextButton from '@/components/buttons/TextButton.vue'
import SaveButton from '@/components/buttons/SaveButton.vue'
import { useArtifactTransitionPreview } from '@/composables/artifacts/use-artifact-transition-preview'
import { errorMessage } from '@/utils/error-message'
import { useAgentStore } from '@/stores/agent-store'
import { useArtifactTransitionStore } from '@/stores/artifact-transition-store'
import ArtifactTransitionConsequences from './ArtifactTransitionConsequences.vue'
import ArtifactTransitionStatus from './ArtifactTransitionStatus.vue'
import type { Artifact } from '@/api/types'

const props = withDefaults(
  defineProps<{
    artifactId: string
    target: Artifact['status'] | null
    /** False while the document body is not verified; a new start is refused. */
    contentReady?: boolean
  }>(),
  { contentReady: true }
)
const open = defineModel<boolean>({ required: true })
const { t } = useI18n()
const agent = useAgentStore()
const store = useArtifactTransitionStore()
const submitting = shallowRef(false)
const submitError = shallowRef<string | null>(null)
const presetId = shallowRef<string | null>(null)
const {
  preview,
  loading,
  expired,
  refreshed,
  error: previewError,
  load
} = useArtifactTransitionPreview(
  () => props.artifactId,
  () => props.target,
  open,
  submitting
)
const presets = computed(() => agent.presets)
const error = computed(() => submitError.value ?? previewError.value)
const canConfirm = computed(
  () =>
    Boolean(preview.value?.canConfirm) &&
    !expired.value &&
    !loading.value &&
    !submitting.value &&
    props.contentReady &&
    presets.value.some(item => item.id === presetId.value && item.available)
)

watch(
  open,
  value => {
    if (value) {
      presetId.value = store.lastPreset()
      submitError.value = null
    }
  },
  { immediate: true }
)

// A body check that fails makes the shown consequences untrustworthy.
watch(
  () => props.contentReady,
  ready => {
    if (!ready && open.value && !submitting.value) {
      open.value = false
    }
  }
)

function refresh() {
  submitError.value = null
  void load()
}
async function confirm() {
  if (!canConfirm.value || !preview.value || !presetId.value) return
  submitting.value = true
  submitError.value = null
  try {
    await store.begin(props.artifactId, preview.value.previewId, presetId.value)
    open.value = false
  } catch (cause) {
    submitError.value = errorMessage(cause)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <q-dialog v-model="open" persistent>
    <q-card class="artifact-transition-dialog">
      <DialogHeader
        :title="t('artifacts.transition.dialogTitle')"
        :close-label="t('artifacts.transition.close')"
        :disable-close="submitting"
      />
      <q-card-section class="q-pt-none">
        <ArtifactTransitionConsequences v-if="preview" :preview="preview" />
        <div v-else-if="loading">{{ t('artifacts.transition.loading') }}</div>
        <ArtifactTransitionStatus
          :blockers="preview?.blockers ?? []"
          :refreshed="refreshed"
          :expired="expired"
          :error="error"
        />
      </q-card-section>
      <q-card-section class="q-pt-none">
        <q-select
          v-model="presetId"
          dense
          outlined
          emit-value
          map-options
          option-value="id"
          option-label="title"
          :option-disable="item => !item.available"
          :options="presets"
          :label="t('artifacts.transition.validator')"
          :hint="t('artifacts.transition.validatorHint')"
        />
        <div
          v-if="!presets.some(item => item.available)"
          class="text-negative q-mt-sm"
          >{{ t('artifacts.transition.validatorNone') }}</div
        >
      </q-card-section>
      <q-card-actions align="right">
        <TextButton
          v-if="expired || error"
          :dense="false"
          size="md"
          :label="t('artifacts.transition.refresh')"
          :disable="loading || submitting"
          @click="refresh"
        />
        <TextButton
          :dense="false"
          size="md"
          :label="t('artifacts.transition.no')"
          :disable="submitting"
          @click="open = false"
        />
        <SaveButton
          :label="t('artifacts.transition.yes')"
          :loading="submitting"
          :disable="!canConfirm"
          @click="confirm"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.artifact-transition-dialog {
  min-width: min(32rem, 92vw);
}
</style>
