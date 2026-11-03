<script setup lang="ts">
import { mdiDownloadOutline } from '@mdi/js'
import { shallowRef, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { downloadFile } from '@/utils/download'
import { errorMessage } from '@/utils/error-message'
import type { ArtifactExportFormat } from '../../../shared/artifacts/types.ts'

const props = withDefaults(
  defineProps<{
    artifactId: string
    /** False after an integrity failure; the server still checks the file. */
    originalAllowed?: boolean
  }>(),
  { originalAllowed: true }
)
const { t } = useI18n()
const busy = shallowRef(false)
const error = shallowRef<string | null>(null)
let controller: AbortController | null = null
let disposed = false
async function download(format: ArtifactExportFormat) {
  if (busy.value) return
  controller = new AbortController()
  busy.value = true
  error.value = null
  try {
    await downloadFile(
      '/api/artifacts/' +
        encodeURIComponent(props.artifactId) +
        '/export?format=' +
        format,
      'artifact-' +
        props.artifactId +
        (format === 'original' ? '.md' : '.metadata-history.json'),
      controller.signal
    )
  } catch (failure) {
    if (!disposed) error.value = errorMessage(failure)
  } finally {
    if (!disposed) busy.value = false
  }
}
onUnmounted(() => {
  disposed = true
  controller?.abort()
})
</script>
<template>
  <div>
    <q-btn
      class="app-icon-control"
      flat
      round
      :icon="mdiDownloadOutline"
      :loading="busy"
      :disable="busy"
      :aria-label="t('artifacts.export.menu')"
    >
      <q-menu
        ><q-list>
          <q-item
            v-close-popup
            clickable
            :disable="!originalAllowed"
            @click="download('original')"
            ><q-item-section
              ><q-item-label>{{ t('artifacts.export.original') }}</q-item-label
              ><q-item-label v-if="!originalAllowed" caption>{{
                t('artifacts.content.blocked')
              }}</q-item-label></q-item-section
            ></q-item
          >
          <q-item v-close-popup clickable @click="download('metadata-history')"
            ><q-item-section>{{
              t('artifacts.export.history')
            }}</q-item-section></q-item
          >
        </q-list></q-menu
      >
    </q-btn>
    <div
      v-if="error"
      role="alert"
      class="text-negative artifact-export-error"
      >{{ error }}</div
    >
  </div>
</template>
<style scoped>
.artifact-export-error {
  max-width: 260px;
  overflow-wrap: anywhere;
}
</style>
