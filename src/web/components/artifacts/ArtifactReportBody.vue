<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import MarkdownContent from '@/components/MarkdownContent.vue'
import type { readArtifactValidationReport } from '@/utils/artifact-validation-report'

defineProps<{
  report: Awaited<ReturnType<typeof readArtifactValidationReport>>
  /** Markdown report text stored with the validation (ADR 0122). */
  text?: string | null
  titles: Record<string, string>
  loading: boolean
  error: string | null
}>()
const { t } = useI18n()
</script>

<template>
  <div aria-live="polite">
    <q-spinner v-if="loading" />
    <span v-if="loading" class="q-ml-sm">{{
      t('artifacts.transition.resultLoading')
    }}</span>
    <div v-else-if="error" class="text-negative" role="alert">
      {{ t('artifacts.transition.resultFailed') }}: {{ error }}
    </div>
    <div
      v-else-if="
        !text &&
        (!report || (!report.findings.length && !report.resolutions.length))
      "
    >
      {{ t('artifacts.transition.resultEmpty') }}
    </div>
    <template v-else>
      <template v-if="report?.findings.length">
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
              <q-item-label caption class="artifact-report__quote">{{
                item.quote
              }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </template>
      <template v-if="report?.resolutions.length">
        <div class="text-subtitle2 q-mt-md">{{
          t('artifacts.transition.resolutions')
        }}</div>
        <ul class="q-my-xs">
          <li v-for="(item, index) in report.resolutions" :key="index">{{
            item
          }}</li>
        </ul>
      </template>
      <template v-if="text">
        <div class="text-subtitle2 q-mt-md">{{
          t('artifacts.transition.reportText')
        }}</div>
        <MarkdownContent :text="text" disable-images />
      </template>
    </template>
  </div>
</template>

<style scoped>
.artifact-report__quote {
  white-space: pre-wrap;
}
</style>
