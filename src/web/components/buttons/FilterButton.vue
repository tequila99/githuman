<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { mdiFilter, mdiFilterOutline } from '@mdi/js'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'

defineProps<{ active: boolean }>()
const { t } = useI18n()
</script>

<template>
  <q-btn
    class="app-icon-control"
    flat
    round
    dense
    :icon="active ? mdiFilter : mdiFilterOutline"
    :color="active ? 'primary' : undefined"
    :aria-label="t('common.filters.title')"
    :aria-pressed="active"
  >
    <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
      t('common.filters.title')
    }}</q-tooltip>
  </q-btn>
</template>
