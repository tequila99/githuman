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
    icon="edit"
    color="secondary"
  >
    <q-tooltip v-if="tooltip">{{ tooltip }}</q-tooltip>
  </q-btn>
</template>
