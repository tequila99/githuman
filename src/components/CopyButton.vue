<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ value: string; tooltip: string }>()

const copied = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | undefined

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value)
    copied.value = true
    clearTimeout(resetTimer)
    resetTimer = setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    // Clipboard API unavailable (e.g. insecure context) — nothing to recover.
  }
}
</script>

<template>
  <q-btn
    v-ripple
    flat
    dense
    round
    size="sm"
    :color="copied ? 'positive' : undefined"
    :icon="copied ? 'check' : 'content_copy'"
    :aria-label="tooltip"
    @click.stop="copy"
  >
    <q-tooltip>{{ tooltip }}</q-tooltip>
  </q-btn>
</template>
