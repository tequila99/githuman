<script setup lang="ts">
import { mdiShieldCheckOutline } from '@mdi/js'
import { useI18n } from 'vue-i18n'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'

defineProps<{ count: number; loading: boolean; failed: boolean }>()
const emit = defineEmits<{ (e: 'open'): void }>()
const { t } = useI18n()
</script>

<template>
  <q-btn
    v-ripple
    flat
    round
    dense
    class="app-icon-control"
    :icon="mdiShieldCheckOutline"
    :loading="loading && count === 0"
    :aria-label="
      count
        ? `${t('nav.artifactActions')}: ${t('artifacts.actions.queueCount', { count })}`
        : t('nav.artifactActions')
    "
    @click="emit('open')"
  >
    <q-badge v-if="count" color="primary" floating class="app-icon-badge">{{
      count
    }}</q-badge>
    <q-badge v-else-if="failed" color="negative" floating class="app-icon-badge"
      >!</q-badge
    >
    <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
      t('nav.artifactActions')
    }}</q-tooltip>
  </q-btn>
  <!-- A new request changes the count; screen readers hear it without a focus move. -->
  <span class="sr-only" role="status" aria-live="polite">{{
    count ? t('artifacts.actions.queueCount', { count }) : ''
  }}</span>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
