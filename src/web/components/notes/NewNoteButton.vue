<script setup lang="ts">
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
</script>
<template>
  <q-btn flat dense round icon="add" :aria-label="$t('notes.newNote')">
    <q-tooltip :delay="TOOLTIP_DELAY_MS">{{ $t('notes.newNote') }}</q-tooltip>
  </q-btn>
</template>
