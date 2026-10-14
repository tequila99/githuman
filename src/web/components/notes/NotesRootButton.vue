<script setup lang="ts">
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
</script>
<template>
  <q-btn flat dense round icon="home" :aria-label="$t('notes.root')">
    <q-tooltip :delay="TOOLTIP_DELAY_MS">{{ $t('notes.root') }}</q-tooltip>
  </q-btn>
</template>
