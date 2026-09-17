<script setup lang="ts">
import { ref } from 'vue'
import { useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  /** GET endpoint returning the file's raw content (e.g. text/markdown). */
  url: string
  filename: string
  tooltip?: string
}>()

const $q = useQuasar()
const { t } = useI18n()
const downloading = ref(false)

async function download() {
  downloading.value = true

  try {
    const response = await fetch(props.url)
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`)
    }
    const text = await response.text()

    const blobUrl = URL.createObjectURL(
      new Blob([text], { type: 'text/markdown' })
    )
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = props.filename
    link.click()
    URL.revokeObjectURL(blobUrl)
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: t('reviews.detail.downloadError'),
      caption: err instanceof Error ? err.message : String(err)
    })
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
