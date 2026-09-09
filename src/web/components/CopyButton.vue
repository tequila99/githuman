<script setup lang="ts">
import { ref } from 'vue'
import { copyToClipboard } from 'quasar'

const props = defineProps<{ value: string; tooltip: string }>()

const copied = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | undefined

async function copy() {
  try {
    // Quasar's helper falls back to a hidden-textarea + execCommand('copy')
    // when navigator.clipboard is unavailable — notably in an insecure
    // context, which is exactly what `serve --host 0.0.0.0` (ADR 0008) is:
    // plain http:// on the LAN. A bare navigator.clipboard.writeText() call
    // would silently no-op for every LAN user.
    await copyToClipboard(props.value)
    copied.value = true
    clearTimeout(resetTimer)
    resetTimer = setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    // Clipboard unavailable even with the fallback — nothing to recover.
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
