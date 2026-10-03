<script setup lang="ts">
import PreviewDialog from './PreviewDialog.vue'

defineProps<{ src: string; title: string; alt: string }>()
const open = defineModel<boolean>({ required: true })
</script>

<template>
  <PreviewDialog v-model="open" :title="title">
    <img v-if="src" class="image-preview" :src="src" :alt="alt" />
  </PreviewDialog>
</template>

<style scoped>
.image-preview {
  display: block;
  max-width: calc(94vw - 32px);
  max-height: calc(92vh - 96px);
  margin: 16px auto;
  object-fit: contain;
}
</style>
