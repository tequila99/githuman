<script setup lang="ts">
import {
  mdiFileDocumentOutline,
  mdiFlaskOutline,
  mdiFormatListChecks,
  mdiGavel,
  mdiLightbulbOutline,
  mdiTextBoxOutline
} from '@mdi/js'

// Type icons keep rows recognizable without adding another text label.
const TYPE_ICONS = new Map([
  ['adr', mdiGavel],
  ['plan', mdiFormatListChecks],
  ['specification', mdiFileDocumentOutline],
  ['prd', mdiFileDocumentOutline],
  ['proposal', mdiLightbulbOutline],
  ['research', mdiFlaskOutline],
  ['report', mdiTextBoxOutline]
])

defineProps<{ typeId: string; size?: string }>()
</script>

<template>
  <q-icon
    :name="TYPE_ICONS.get(typeId) ?? mdiFileDocumentOutline"
    :size="size"
    aria-hidden="true"
    class="app-icon-neutral"
  />
</template>
