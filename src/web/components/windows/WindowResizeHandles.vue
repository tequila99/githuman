<script setup lang="ts">
import { useWindowGeometry } from '@/composables/windows/use-window-geometry'
import { RESIZE_EDGES } from '@/constants/windows/constants'

const props = defineProps<{
  windowId: string
  minimum?: { width: number; height: number } | undefined
}>()
const resize = useWindowGeometry(props.windowId, props.minimum)
</script>

<template>
  <div
    v-for="edge in RESIZE_EDGES"
    :key="edge"
    class="terminal-resize"
    :class="'terminal-resize--' + edge"
    @pointerdown="resize.start($event, edge)"
    @pointermove="resize.move"
    @pointerup="resize.end"
    @pointercancel="resize.end"
    @lostpointercapture="resize.end"
  />
</template>

<style scoped>
/* The visible border stays thin. Each invisible grab zone is centered on the border: half outside, half inside. */
.terminal-resize {
  position: absolute;
  z-index: 2;
  touch-action: none;
  --edge: 8px;
  --corner: 12px;
  --outside: calc(var(--edge) / -2);
  /* An edge starts where a corner ends, so no gap stays between them. */
  --edge-inset: calc(var(--corner) + var(--outside));
}
.terminal-resize--n,
.terminal-resize--s {
  left: var(--edge-inset);
  right: var(--edge-inset);
  height: var(--edge);
  cursor: ns-resize;
}
.terminal-resize--e,
.terminal-resize--w {
  top: var(--edge-inset);
  bottom: var(--edge-inset);
  width: var(--edge);
  cursor: ew-resize;
}
.terminal-resize--ne,
.terminal-resize--nw,
.terminal-resize--se,
.terminal-resize--sw {
  width: var(--corner);
  height: var(--corner);
}
.terminal-resize--n,
.terminal-resize--ne,
.terminal-resize--nw {
  top: var(--outside);
}
.terminal-resize--s,
.terminal-resize--se,
.terminal-resize--sw {
  bottom: var(--outside);
}
.terminal-resize--e,
.terminal-resize--ne,
.terminal-resize--se {
  right: var(--outside);
}
.terminal-resize--w,
.terminal-resize--nw,
.terminal-resize--sw {
  left: var(--outside);
}
.terminal-resize--ne,
.terminal-resize--sw {
  cursor: nesw-resize;
}
.terminal-resize--nw,
.terminal-resize--se {
  cursor: nwse-resize;
}
</style>
