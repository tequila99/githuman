<script setup lang="ts">
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
defineProps<{
  tooltip?: string
}>()
</script>

<template>
  <q-btn
    v-bind="$attrs"
    padding="4px"
    flat
    dense
    round
    icon="delete_outline"
    color="warning"
  >
    <q-tooltip :delay="TOOLTIP_DELAY_MS" v-if="tooltip">{{
      tooltip
    }}</q-tooltip>
  </q-btn>
</template>
