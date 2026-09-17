<script setup lang="ts">
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
    <q-tooltip v-if="tooltip">{{ tooltip }}</q-tooltip>
  </q-btn>
</template>
