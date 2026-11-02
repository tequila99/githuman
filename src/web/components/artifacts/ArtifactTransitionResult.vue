<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import DialogHeader from '@/components/DialogHeader.vue'
import TextButton from '@/components/buttons/TextButton.vue'
import { useArtifactTransitionResult } from '@/composables/artifacts/use-artifact-transition-result'
import type { ArtifactTransitionOperation } from '@/api/types'

const props = defineProps<{ operation: ArtifactTransitionOperation }>()
const open = defineModel<boolean>({ required: true })
const { t } = useI18n()
const { report, titles, loading, error, load } = useArtifactTransitionResult(
  () => props.operation.validationId,
  open
)
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
      <q-card-section class="q-pt-none" aria-live="polite">
        <q-spinner v-if="loading" />
        <span v-if="loading" class="q-ml-sm">{{
          t('artifacts.transition.resultLoading')
        }}</span>
        <div v-else-if="error" class="text-negative" role="alert">
          {{ t('artifacts.transition.resultFailed') }}: {{ error }}
        </div>
        <div
          v-else-if="
            !report || (!report.findings.length && !report.resolutions.length)
          "
        >
          {{ t('artifacts.transition.resultEmpty') }}
        </div>
        <template v-else>
          <template v-if="report.findings.length">
            <div class="text-subtitle2">{{
              t('artifacts.transition.findings')
            }}</div>
            <q-list separator dense>
              <q-item v-for="(item, index) in report.findings" :key="index">
                <q-item-section>
                  <q-item-label>{{
                    titles[item.artifactId] ?? item.artifactId
                  }}</q-item-label>
                  <q-item-label>{{ item.message }}</q-item-label>
                  <q-item-label
                    caption
                    class="artifact-transition-result__quote"
                    >{{ item.quote }}</q-item-label
                  >
                </q-item-section>
              </q-item>
            </q-list>
          </template>
          <template v-if="report.resolutions.length">
            <div class="text-subtitle2 q-mt-md">{{
              t('artifacts.transition.resolutions')
            }}</div>
            <ul class="q-my-xs">
              <li v-for="(item, index) in report.resolutions" :key="index">{{
                item
              }}</li>
            </ul>
          </template>
        </template>
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
        <TextButton
          v-if="error"
          :dense="false"
          size="md"
          :label="t('artifacts.transition.retry')"
          @click="load"
        />
        <TextButton
          :dense="false"
          size="md"
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
.artifact-transition-result__quote {
  white-space: pre-wrap;
}
</style>
