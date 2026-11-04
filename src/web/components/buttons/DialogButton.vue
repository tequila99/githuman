<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<template>
  <q-btn flat no-caps size="md" :label="label" />
</template>
