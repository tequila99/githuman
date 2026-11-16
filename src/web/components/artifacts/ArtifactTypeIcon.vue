<script setup lang="ts">
import { computed } from 'vue'
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

const props = defineProps<{ typeId: string; size?: string }>()
const icon = computed(
  () => TYPE_ICONS.get(props.typeId) ?? mdiFileDocumentOutline
)
</script>

<template>
  <q-icon
    :name="icon"
    :size="size"
    aria-hidden="true"
    class="app-icon-neutral"
  />
</template>
