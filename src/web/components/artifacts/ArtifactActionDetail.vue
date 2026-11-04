<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import TextButton from '@/components/buttons/TextButton.vue'
import ArtifactActionScope from '@/components/artifacts/ArtifactActionScope.vue'
import ArtifactActionReport from '@/components/artifacts/ArtifactActionReport.vue'
import { useArtifactSessionLabel } from '@/composables/artifacts/use-artifact-session-label'
import { formatDateTime } from '@/utils/date'
import type { ArtifactActionsModel } from '@/stores/artifact-actions-store'
import type { ArtifactActionAvailability } from '@/utils/artifact-action-state'

const props = defineProps<{
  model: ArtifactActionsModel
  narrow: boolean
  availability: ArtifactActionAvailability
}>()
const emit = defineEmits<{ (e: 'back' | 'refresh'): void }>()
const { t } = useI18n()
const sessionLabel = useArtifactSessionLabel()
const state = computed(() => props.model.state)
const inspection = computed(() => state.value.inspection)
const ended = computed(
  () => state.value.outcome === 'revoked' || state.value.unavailable
)
</script>

<template>
  <div class="q-pa-md">
    <TextButton
      v-if="state.selectedId && (narrow || ended)"
      :label="t('artifacts.actions.back')"
      :disable="state.busy"
      @click="emit('back')"
    />
    <div v-if="!state.selectedId" class="text-grey">
      {{ t('artifacts.actions.selectRequest') }}
    </div>
    <div v-else-if="state.outcome === 'revoked'" role="status">
      {{ t('artifacts.actions.revokedNote') }}
    </div>
    <div v-else-if="state.outcome === 'applied' && !inspection" role="status">
      {{ t('artifacts.actions.applied') }}
    </div>
    <div v-else-if="state.unavailable" role="alert">
      {{ t('artifacts.actions.unavailable') }}
    </div>
    <q-spinner v-else-if="!inspection && state.loading" />
    <div v-else-if="!inspection" class="text-negative" role="alert">
      {{ t('artifacts.actions.scopeFailed') }}: {{ state.error }}
      <TextButton
        :label="t('artifacts.actions.refreshScope')"
        @click="emit('refresh')"
      />
    </div>
    <template v-else>
      <ArtifactActionScope
        :inspection="inspection"
        :session-label="sessionLabel(inspection.pending.sessionId)"
      />
      <div class="text-caption q-mt-sm">
        {{
          t('artifacts.actions.timeLeft', {
            time: formatDateTime(inspection.pending.expiresAt)
          })
        }}
      </div>
      <div v-if="state.expired" class="text-negative" role="alert">
        {{ t('artifacts.actions.expired') }}
      </div>
      <div v-if="inspection.problem" class="text-negative" role="alert">
        {{ t('artifacts.actions.blocked', { problem: inspection.problem }) }}
      </div>
      <div
        v-if="inspection.phase === 'consumed' || state.outcome === 'applied'"
        role="status"
      >
        {{ t('artifacts.actions.applied') }}
      </div>
      <div v-if="availability.grantedToAgent" role="status">
        {{ t('artifacts.actions.granted') }}
      </div>
      <div v-if="state.refreshError" class="text-negative" role="alert">
        {{
          t('artifacts.actions.grantedRefreshFailed', {
            error: state.refreshError
          })
        }}
      </div>
      <div v-else-if="state.error" class="text-negative" role="alert">
        {{ state.error }}
      </div>
      <!-- The key resets the report when another request is selected. -->
      <ArtifactActionReport
        :key="state.selectedId"
        :validation-id="inspection.pending.action.validationId"
      />
    </template>
  </div>
</template>
