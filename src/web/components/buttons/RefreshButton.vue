<script setup lang="ts">
import { mdiRefresh } from '@mdi/js'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'

defineProps<{ tooltip: string }>()
</script>
<template>
  <q-btn
    flat
    dense
    round
    class="app-icon-control"
    :icon="mdiRefresh"
    :aria-label="tooltip"
  >
    <q-tooltip :delay="TOOLTIP_DELAY_MS">{{ tooltip }}</q-tooltip>
    <slot />
  </q-btn>
</template>
