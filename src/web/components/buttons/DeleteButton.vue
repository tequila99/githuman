<script setup lang="ts">
import { mdiTrashCanOutline } from '@mdi/js'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
defineProps<{
  tooltip?: string
}>()
</script>

<template>
  <q-btn
    class="app-icon-control"
    v-bind="$attrs"
    padding="4px"
    flat
    dense
    round
    :icon="mdiTrashCanOutline"
    color="negative"
  >
    <q-tooltip :delay="TOOLTIP_DELAY_MS" v-if="tooltip">{{
      tooltip
    }}</q-tooltip>
  </q-btn>
</template>
