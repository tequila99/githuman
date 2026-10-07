<script setup lang="ts">
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import { onBeforeUnmount, onDeactivated, ref } from 'vue'
import { copyToClipboard, useTimeout } from 'quasar'
import { COPIED_FEEDBACK_MS } from '@/utils/copy-code'

const props = defineProps<{ value: string; tooltip: string }>()

const copied = ref(false)
const { registerTimeout } = useTimeout()
let generation = 0

function resetCopied() {
  generation++
  copied.value = false
}

onBeforeUnmount(resetCopied)
onDeactivated(resetCopied)

async function copy() {
  const current = generation
  try {
    // Quasar also supports clipboard access over plain HTTP in the LAN.
    await copyToClipboard(props.value)
    if (current !== generation) return
    copied.value = true
    registerTimeout(() => {
      copied.value = false
    }, COPIED_FEEDBACK_MS)
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
    <q-tooltip :delay="TOOLTIP_DELAY_MS">{{ tooltip }}</q-tooltip>
  </q-btn>
</template>
