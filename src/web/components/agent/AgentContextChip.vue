<script setup lang="ts">
import { mdiDownloadOutline } from '@mdi/js'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentContextItem } from '@/api/types'
import { contextLabel } from '@/utils/agent-context-label'

const props = defineProps<{
  item: AgentContextItem
  removable?: boolean
  downloadable?: boolean
}>()
const emit = defineEmits<{ remove: []; download: [] }>()
const { t } = useI18n()
const label = computed(() => contextLabel(props.item, t))
const canDownload = computed(
  () => props.downloadable && props.item.kind === 'attachment'
)
</script>

<template>
  <q-chip
    dense
    square
    size="sm"
    :removable="removable"
    :clickable="canDownload"
    :icon="canDownload ? mdiDownloadOutline : undefined"
    :label="label"
    @remove="emit('remove')"
    @click="canDownload && emit('download')"
  />
</template>
