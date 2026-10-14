<script setup lang="ts">
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import { mdiFolderPlusOutline } from '@mdi/js'
</script>
<template>
  <q-btn
    flat
    dense
    round
    :icon="mdiFolderPlusOutline"
    :aria-label="$t('notes.newFolder')"
  >
    <q-tooltip :delay="TOOLTIP_DELAY_MS">{{ $t('notes.newFolder') }}</q-tooltip>
  </q-btn>
</template>
