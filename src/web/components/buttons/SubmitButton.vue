<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<template>
  <q-btn type="submit" color="primary" no-caps :label="label" />
</template>
