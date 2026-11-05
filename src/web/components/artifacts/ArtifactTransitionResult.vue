<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import DialogHeader from '@/components/DialogHeader.vue'
import ArtifactReportBody from '@/components/artifacts/ArtifactReportBody.vue'
import DialogButton from '@/components/buttons/DialogButton.vue'
import { useArtifactTransitionResult } from '@/composables/artifacts/use-artifact-transition-result'
import type { ArtifactTransitionOperation } from '@/api/types'

const props = defineProps<{ operation: ArtifactTransitionOperation }>()
const open = defineModel<boolean>({ required: true })
const { t } = useI18n()
const { report, text, titles, loading, error, load } =
  useArtifactTransitionResult(() => props.operation.validationId, open)
</script>

<template>
  <q-dialog v-model="open">
    <q-card class="artifact-transition-result">
      <DialogHeader
        :title="t('artifacts.transition.result')"
        :close-label="t('artifacts.transition.close')"
      />
      <q-card-section class="q-pt-none">
        <div v-if="report" class="text-caption">
          {{ t('artifacts.actions.verdict') }}: {{ report.verdict }}
        </div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <ArtifactReportBody
          :report="report"
          :text="text"
          :titles="titles"
          :loading="loading"
          :error="error"
        />
        <router-link
          v-if="operation.reportArtifactId"
          class="q-mt-md block"
          :to="{
            name: 'artifacts',
            query: {
              storeId: operation.storeId,
              selectedId: operation.reportArtifactId
            }
          }"
          >{{ t('artifacts.transition.report') }}</router-link
        >
      </q-card-section>
      <q-card-actions align="right">
        <DialogButton
          v-if="error"
          :label="t('artifacts.transition.retry')"
          @click="load"
        />
        <DialogButton
          :label="t('artifacts.transition.close')"
          @click="open = false"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.artifact-transition-result {
  min-width: min(36rem, 92vw);
}
</style>
