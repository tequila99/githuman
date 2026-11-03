<script setup lang="ts">
import CloseButton from '@/components/buttons/CloseButton.vue'

defineProps<{ title: string; closeLabel: string; disableClose?: boolean }>()
</script>

<template>
  <q-card-section class="row items-center no-wrap dialog-header">
    <div class="text-h6 col">{{ title }}</div>
    <CloseButton
      v-close-popup="!disableClose"
      :label="closeLabel"
      :disable="disableClose"
    />
  </q-card-section>
</template>

<style scoped>
.dialog-header {
  gap: 16px;
}
</style>
