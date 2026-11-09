<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Task } from '@/api/types'

const props = defineProps<{ state: Task['state'] }>()
const { t } = useI18n()
const label = computed(() => t('tasks.state.' + props.state))
// State colors live in css/artifact-status.scss next to the document statuses.
const background = computed(() => `var(--task-state-${props.state})`)
</script>

<template>
  <q-badge class="task-state-badge" :style="{ background }" :title="label">{{
    label
  }}</q-badge>
</template>

<style scoped>
.task-state-badge {
  flex: 0 0 auto;
  font-family: var(--font-agent);
}
</style>
