<script setup lang="ts">
withDefaults(defineProps<{ label: string; dense?: boolean; size?: string }>(), {
  dense: true,
  size: 'sm'
})
</script>

<template>
  <q-btn flat no-caps :dense="dense" :size="size" :label="label" />
</template>
