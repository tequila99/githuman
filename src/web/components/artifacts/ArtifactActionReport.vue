<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import TextButton from '@/components/buttons/TextButton.vue'
import ArtifactReportBody from '@/components/artifacts/ArtifactReportBody.vue'
import { useArtifactTransitionResult } from '@/composables/artifacts/use-artifact-transition-result'

const props = defineProps<{ validationId: string }>()
const { t } = useI18n()
// The report loads only when the user asks for it.
const shown = ref(false)
const { report, text, titles, loading, error, textError, load } =
  useArtifactTransitionResult(() => props.validationId, shown)
</script>

<template>
  <q-expansion-item
    v-model="shown"
    dense
    class="q-mt-md"
    :label="t('artifacts.actions.reportTitle')"
  >
    <div v-if="report" class="text-caption">
      {{ t('artifacts.actions.verdict') }}: {{ report.verdict }}
    </div>
    <ArtifactReportBody
      :report="report"
      :text="text"
      :titles="titles"
      :loading="loading"
      :error="error"
      :text-error="textError"
    />
    <TextButton
      v-if="error || textError"
      :label="t('artifacts.transition.retry')"
      @click="load"
    />
  </q-expansion-item>
</template>
