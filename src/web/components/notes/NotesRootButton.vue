<script setup lang="ts">
import { mdiHomeOutline } from '@mdi/js'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
</script>
<template>
  <q-btn
    class="app-icon-control"
    flat
    dense
    round
    :icon="mdiHomeOutline"
    :aria-label="$t('notes.root')"
  >
    <q-tooltip :delay="TOOLTIP_DELAY_MS">{{ $t('notes.root') }}</q-tooltip>
  </q-btn>
</template>
