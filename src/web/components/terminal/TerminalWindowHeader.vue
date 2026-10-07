<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import type { PanEvent } from '@/composables/use-terminal-window-geometry'
import TerminalWindowMenu from './TerminalWindowMenu.vue'

const props = defineProps<{
  maximized: boolean
  connected: boolean
  originalColors: boolean
}>()
const emit = defineEmits<{
  drag: [event: PanEvent]
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
      v-touch-pan.prevent.mouse="(event: PanEvent) => emit('drag', event)"
      class="window-header__title terminal-header__drag col row items-center"
      :class="{ 'terminal-header__drag--static': maximized }"
      @dblclick="emit('toggleMaximized')"
    >
      <q-icon size="16px" name="terminal" class="q-mr-sm" />
      <span>{{ t('terminal.title') }}</span>
    </div>
    <q-btn
      flat
      dense
      size="sm"
      class="window-header__control"
      icon="more_vert"
      :aria-label="t('terminal.menu')"
    >
      <TerminalWindowMenu
        :maximized="maximized"
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
      class="window-header__control"
      icon="minimize"
      :aria-label="t('terminal.minimize')"
      @click="emit('minimize')"
    >
      <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
        t('terminal.minimize')
      }}</q-tooltip>
    </q-btn>
    <q-btn
      flat
      dense
      size="sm"
      class="window-header__control"
      :icon="maximized ? 'filter_none' : 'crop_square'"
      :aria-label="maximizeLabel"
      @click="emit('toggleMaximized')"
    >
      <q-tooltip :delay="TOOLTIP_DELAY_MS">{{ maximizeLabel }}</q-tooltip>
    </q-btn>
    <q-btn
      flat
      dense
      size="sm"
      class="window-header__control"
      icon="close"
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
