<script setup lang="ts">
import type { notePropertyLink } from '@/utils/notes/properties'
defineProps<{
  link: NonNullable<ReturnType<typeof notePropertyLink>>
  showExternalIcon?: boolean
}>()
</script>
<template>
  <a
    class="note-property-link"
    :href="link.href"
    :target="link.external ? '_blank' : undefined"
    rel="noopener noreferrer"
    >{{ link.label
    }}<q-icon
      v-if="showExternalIcon && link.external"
      name="open_in_new"
      size="13px"
  /></a>
</template>
<style scoped>
.note-property-link {
  overflow-wrap: anywhere;
}
.note-property-link .q-icon {
  margin-left: 3px;
  color: #888;
}
</style>
