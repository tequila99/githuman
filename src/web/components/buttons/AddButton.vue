<script setup lang="ts">
import { mdiPlus } from '@mdi/js'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'

defineProps<{ tooltip?: string; label?: string }>()
</script>
<template>
  <q-btn
    flat
    dense
    :round="!label"
    :no-caps="Boolean(label)"
    :label="label"
    class="app-icon-control"
    :icon="mdiPlus"
    :aria-label="tooltip"
  >
    <q-tooltip v-if="tooltip" :delay="TOOLTIP_DELAY_MS">{{
      tooltip
    }}</q-tooltip>
    <slot />
  </q-btn>
</template>
