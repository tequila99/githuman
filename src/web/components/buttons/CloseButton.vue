<script setup lang="ts">
import { mdiClose } from '@mdi/js'

defineProps<{ label: string }>()
</script>

<template>
  <q-btn
    flat
    round
    dense
    class="app-icon-control"
    :icon="mdiClose"
    :aria-label="label"
  />
</template>
