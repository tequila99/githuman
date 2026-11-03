<script setup lang="ts">
import { mdiFolderOpenOutline } from '@mdi/js'
</script>
<template>
  <div
    class="notes-folder-empty col column items-center justify-center q-pa-lg"
  >
    <slot name="icon"
      ><q-icon
        :name="mdiFolderOpenOutline"
        size="32px"
        class="app-icon-neutral q-mb-sm"
    /></slot>
    <div class="notes-folder-empty__title"><slot name="title" /></div>
    <p class="text-grey q-mt-sm"><slot /></p>
    <div v-if="$slots.actions" class="row justify-center q-gutter-sm"
      ><slot name="actions"
    /></div>
  </div>
</template>
<style scoped>
.notes-folder-empty__title {
  overflow-wrap: anywhere;
  max-width: 100%;
  font-weight: 400;
}
</style>
