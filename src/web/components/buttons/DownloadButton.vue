<script setup lang="ts">
import { ref } from 'vue'
import { exportFile } from 'quasar'
import { useI18n } from 'vue-i18n'
import { useNotifyError } from '@/composables/use-notify-error'

const props = defineProps<{
  /** GET endpoint returning the file's raw content (e.g. text/markdown). */
  url: string
  filename: string
  tooltip?: string
}>()

const { t } = useI18n()
const notifyError = useNotifyError()
const downloading = ref(false)

async function download() {
  downloading.value = true

  try {
    const response = await fetch(props.url)
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`)
    }
    const text = await response.text()

    // exportFile returns the error instead of throwing it.
    const result = exportFile(props.filename, text, 'text/markdown')
    if (result !== true) throw result
  } catch (err) {
    notifyError(t('reviews.detail.downloadError'), err)
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <q-btn
    v-bind="$attrs"
    padding="4px"
    flat
    dense
    round
    :loading="downloading"
    icon="download"
    :aria-label="tooltip"
    @click.stop="download"
  >
    <q-tooltip v-if="tooltip">{{ tooltip }}</q-tooltip>
  </q-btn>
</template>
