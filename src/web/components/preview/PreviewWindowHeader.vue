<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import type { WindowPanEvent } from '@/composables/windows/use-window-geometry'

defineProps<{ maximized: boolean }>()
const emit = defineEmits<{
  drag: [event: WindowPanEvent]
  openFile: []
  minimize: []
  toggleMaximized: []
  closeAll: []
}>()
const { t } = useI18n()
</script>

<template>
  <div class="window-header row items-center no-wrap">
    <div
      v-touch-pan.prevent.mouse="(event: WindowPanEvent) => emit('drag', event)"
      class="window-header__title preview-title col ellipsis"
      @dblclick="emit('toggleMaximized')"
      ><q-icon size="16px" name="visibility" class="q-mr-sm" />{{
        t('windows.preview')
      }}</div
    >
    <q-btn
      flat
      dense
      size="sm"
      class="window-header__control"
      icon="folder_open"
      :aria-label="t('windows.openFile')"
      @click="emit('openFile')"
    >
      <q-tooltip :delay="TOOLTIP_DELAY_MS">{{
        t('windows.openFile')
      }}</q-tooltip>
    </q-btn>
    <q-btn
      flat
      dense
      size="sm"
      class="window-header__control"
      icon="minimize"
      :aria-label="t('windows.minimize')"
      @click="emit('minimize')"
    />
    <q-btn
      flat
      dense
      size="sm"
      class="window-header__control"
      :icon="maximized ? 'filter_none' : 'crop_square'"
      :aria-label="t(maximized ? 'terminal.restore' : 'terminal.maximize')"
      @click="emit('toggleMaximized')"
    />
    <q-btn
      flat
      dense
      size="sm"
      class="window-header__control"
      icon="close"
      :aria-label="t('windows.closeAll')"
      @click="emit('closeAll')"
    />
  </div>
</template>

<style scoped>
.preview-title {
  cursor: move;
  user-select: none;
}
</style>
