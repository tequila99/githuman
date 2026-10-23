<script setup lang="ts">
import { provide } from 'vue'
import { PANE_VISIBLE } from '@/composables/use-pane-visibility'
const { active } = defineProps<{ active: boolean }>()
provide(PANE_VISIBLE, () => active)
</script>
<template>
  <div
    class="fit column no-wrap"
    :inert="!active"
    :aria-hidden="!active"
    :style="!active ? { visibility: 'hidden' } : undefined"
    ><slot :active="active"
  /></div>
</template>
