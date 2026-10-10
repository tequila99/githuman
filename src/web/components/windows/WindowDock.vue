<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { useQuasar, useElementSize } from 'quasar'
import { useWindowStore } from '@/stores/windows/window-store'
import { dockPosition, dockEdge } from '@/utils/windows/dock-geometry'
import type { WindowApplication } from '@/types/windows/window'
import type { WindowPanEvent } from '@/composables/windows/use-window-geometry'
import { errorMessage } from '@/utils/error-message'
import { useI18n } from 'vue-i18n'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'

const props = defineProps<{ applications: readonly WindowApplication[] }>()
const store = useWindowStore()
const $q = useQuasar()
const { t } = useI18n()
const el = useTemplateRef<HTMLElement>('dock')
const { elementSize } = useElementSize({ target: () => el.value })
const busy = ref<string[]>([])
const viewport = computed(() => ({
  width: $q.screen.width,
  height: $q.screen.height
}))
const vertical = computed(
  () => store.dock.edge === 'left' || store.dock.edge === 'right'
)
const position = computed(() =>
  dockPosition(
    store.dock.position ?? {
      x: (viewport.value.width - elementSize.value.width) / 2,
      y: viewport.value.height
    },
    store.dock.edge,
    elementSize.value,
    viewport.value
  )
)
const entries = computed(() =>
  props.applications.map(app => ({
    app,
    availability: app.availability(),
    badge: app.badge(),
    active: app.active()
  }))
)
let start = { x: 0, y: 0 }
function drag(event: WindowPanEvent) {
  if (event.isFirst) {
    start = { ...position.value }
    store.dock.edge = 'free'
  }
  const next = {
    x: start.x + (event.offset?.x ?? 0),
    y: start.y + (event.offset?.y ?? 0)
  }
  store.dock.position = next
  if (event.isFinal) {
    store.dock.edge = dockEdge(
      position.value,
      elementSize.value,
      viewport.value
    )
    store.remember()
  }
}
async function activate(app: WindowApplication) {
  if (!app.availability().enabled || busy.value.includes(app.id)) return
  busy.value.push(app.id)
  try {
    await app.activate()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error) })
  } finally {
    busy.value = busy.value.filter(id => id !== app.id)
  }
}
</script>

<template>
  <nav
    ref="dock"
    class="window-dock"
    :class="{ 'window-dock--vertical': vertical }"
    :style="{ left: `${position.x}px`, top: `${position.y}px` }"
    :aria-label="t('windows.panel')"
  >
    <div
      v-touch-pan.prevent.mouse="drag"
      class="window-dock__handle"
      :aria-label="t('windows.movePanel')"
      ><q-icon name="drag_indicator"
    /></div>
    <div v-for="entry in entries" :key="entry.app.id" class="window-dock__item">
      <q-btn
        flat
        :icon="entry.app.icon"
        class="window-dock__button"
        :class="{
          'window-dock__button--running': entry.active || !!entry.badge
        }"
        :color="entry.active || entry.badge ? 'primary' : undefined"
        :disable="!entry.availability.enabled"
        :loading="busy.includes(entry.app.id)"
        :aria-label="entry.app.title()"
        @click="activate(entry.app)"
      >
        <q-badge v-if="entry.badge" floating color="primary">{{
          entry.badge
        }}</q-badge>
      </q-btn>
      <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
        entry.availability.reason ?? entry.app.title()
      }}</q-tooltip>
    </div>
  </nav>
</template>

<style scoped>
.window-dock {
  position: fixed;
  z-index: 2600;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--window-divider);
  border-radius: 12px;
  background: color-mix(in srgb, var(--window-header-bg) 88%, black);
  box-shadow: var(--window-shadow);
  backdrop-filter: blur(12px);
  max-width: 100vw;
  max-height: 100vh;
}
:global(body.body--dark .window-dock) {
  background: color-mix(in srgb, var(--window-header-bg) 88%, white);
}
.window-dock--vertical {
  flex-direction: column;
}
.window-dock__handle {
  cursor: move;
  touch-action: none;
  display: flex;
  align-items: center;
  padding: 4px;
}
.window-dock__button {
  width: 42px;
  min-height: 42px;
  padding: 0;
  border-radius: 8px;
  border: 1px solid transparent;
}
.window-dock__button--running {
  border-color: color-mix(in srgb, currentColor 65%, transparent);
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, currentColor 18%, transparent),
    color-mix(in srgb, currentColor 7%, transparent)
  );
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.22),
    inset 0 -1px 1px rgba(0, 0, 0, 0.15),
    0 2px 3px rgba(0, 0, 0, 0.2);
}
.window-dock__item {
  position: relative;
}
</style>
