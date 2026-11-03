<script setup lang="ts">
defineProps<{ label: string }>()
</script>
<template>
  <q-btn color="primary" dense no-caps padding="4px 16px" :label="label" />
</template>
