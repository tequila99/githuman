<script setup lang="ts">
import {
  mdiCheckboxBlankOutline,
  mdiCheckboxMultipleBlankOutline,
  mdiClose,
  mdiConsoleLine,
  mdiDotsVertical,
  mdiWindowMinimize
} from '@mdi/js'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import type { WindowPanEvent } from '@/composables/windows/use-window-geometry'
import TerminalWindowMenu from './TerminalWindowMenu.vue'

const props = defineProps<{
  maximized: boolean
  narrow?: boolean
  connected: boolean
  originalColors: boolean
}>()
const emit = defineEmits<{
  drag: [event: WindowPanEvent]
  toggleOriginalColors: []
  minimize: []
  toggleMaximized: []
  closeAll: []
}>()
const { t } = useI18n()
const maximizeLabel = computed(() =>
  t(props.maximized ? 'terminal.restore' : 'terminal.maximize')
)
</script>

<template>
  <div class="window-header row items-center no-wrap">
    <div
      v-touch-pan.prevent.mouse="
        narrow ? undefined : (event: WindowPanEvent) => emit('drag', event)
      "
      class="window-header__title terminal-header__drag col row items-center"
      :class="{ 'terminal-header__drag--static': maximized }"
      @dblclick="!narrow && emit('toggleMaximized')"
    >
      <q-icon
        size="16px"
        :name="mdiConsoleLine"
        class="app-icon-neutral q-mr-sm"
      />
      <span>{{ t('terminal.title') }}</span>
    </div>
    <q-btn
      flat
      dense
      size="sm"
      class="app-icon-control window-header__control"
      :icon="mdiDotsVertical"
      :aria-label="t('terminal.menu')"
    >
      <TerminalWindowMenu
        :maximized="maximized"
        :narrow="narrow"
        :connected="connected"
        :original-colors="originalColors"
        @toggle-original-colors="emit('toggleOriginalColors')"
        @minimize="emit('minimize')"
        @toggle-maximized="emit('toggleMaximized')"
        @close-all="emit('closeAll')"
      />
    </q-btn>
    <q-btn
      flat
      dense
      size="sm"
      class="app-icon-control window-header__control"
      :icon="mdiWindowMinimize"
      v-if="!narrow"
      :aria-label="t('terminal.minimize')"
      @click="emit('minimize')"
    >
      <q-tooltip :delay="TOOLTIP_DELAY_MS"
        >{{ t('terminal.minimize') }} · Ctrl+Win+↓</q-tooltip
      >
    </q-btn>
    <q-btn
      flat
      dense
      size="sm"
      class="app-icon-control window-header__control"
      :icon="
        maximized ? mdiCheckboxMultipleBlankOutline : mdiCheckboxBlankOutline
      "
      v-if="!narrow"
      :aria-label="maximizeLabel"
      @click="emit('toggleMaximized')"
    >
      <q-tooltip :delay="TOOLTIP_DELAY_MS"
        >{{ maximizeLabel }} · Ctrl+Win+↑</q-tooltip
      >
    </q-btn>
    <q-btn
      flat
      dense
      size="sm"
      class="app-icon-control window-header__control"
      :icon="mdiClose"
      :disable="!connected"
      :aria-label="t('terminal.closeAll')"
      @click="emit('closeAll')"
    >
      <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
        t('terminal.closeAll')
      }}</q-tooltip>
    </q-btn>
  </div>
</template>

<style scoped>
.terminal-header__drag {
  cursor: move;
  user-select: none;
}
.terminal-header__drag--static {
  cursor: default;
}
</style>
