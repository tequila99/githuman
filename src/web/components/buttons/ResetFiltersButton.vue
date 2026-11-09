<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { mdiFilterRemoveOutline } from '@mdi/js'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'

const { t } = useI18n()
</script>

<template>
  <q-btn
    class="app-icon-control"
    flat
    round
    dense
    :icon="mdiFilterRemoveOutline"
    :aria-label="t('common.filters.reset')"
  >
    <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
      t('common.filters.reset')
    }}</q-tooltip>
  </q-btn>
</template>
