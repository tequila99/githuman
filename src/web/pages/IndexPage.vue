<template>
  <q-page :style-fn="pageStyleFn">
    <FileExplorer />
  </q-page>
</template>

<script setup lang="ts">
import FileExplorer from '@/components/FileExplorer.vue'

function pageStyleFn(offset: number, height: number) {
  return { height: `${height - offset}px` }
}
</script>
