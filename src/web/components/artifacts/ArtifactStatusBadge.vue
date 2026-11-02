<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Artifact } from '@/api/types'

const props = defineProps<{ status: Artifact['status'] }>()
const { t } = useI18n()
const label = computed(() => t('artifacts.statuses.' + props.status))
// Status colors live in css/artifact-status.scss.
const background = computed(() => `var(--artifact-status-${props.status})`)
</script>

<template>
  <q-badge
    class="artifact-status-badge"
    :style="{ background }"
    :title="label"
    >{{ label }}</q-badge
  >
</template>

<style scoped>
.artifact-status-badge {
  flex: 0 0 auto;
  font-family: var(--font-agent);
}
</style>
