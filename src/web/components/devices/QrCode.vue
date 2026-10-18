<script setup lang="ts">
import { computed } from 'vue'
import { encode } from 'uqr'

const props = defineProps<{ value: string; label: string }>()

// One path of unit squares: the SVG scales without blur, and no HTML is injected.
const qr = computed(() => {
  const { data, size } = encode(props.value, { border: 2 })
  const parts: string[] = []
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x} ${y}h1v1h-1z`)
    })
  )
  return { size, path: parts.join('') }
})
</script>

<template>
  <svg
    class="qr-code"
    role="img"
    :aria-label="label"
    :viewBox="`0 0 ${qr.size} ${qr.size}`"
    shape-rendering="crispEdges"
  >
    <rect :width="qr.size" :height="qr.size" fill="#fff" />
    <path :d="qr.path" fill="#000" />
  </svg>
</template>

<style scoped>
.qr-code {
  width: 200px;
  height: 200px;
}
</style>
