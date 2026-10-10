<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  PREVIEW_MIN_SCALE,
  PREVIEW_MAX_SCALE,
  PREVIEW_SCALE_STEP
} from '@/constants/windows/constants'

withDefaults(
  defineProps<{
    page?: number
    pages?: number
    scale: number
    busy?: boolean
  }>(),
  { page: 0, busy: false }
)
const emit = defineEmits<{ navigate: [delta: number]; zoom: [delta: number] }>()
const { t } = useI18n()
</script>

<template>
  <div class="preview-controls row items-center no-wrap" @click.stop>
    <q-btn
      flat
      dense
      size="var(--control-size-compact)"
      v-if="pages !== undefined"
      icon="chevron_left"
      :disable="page <= 1"
      :aria-label="t('windows.pdfPrevious')"
      @click="emit('navigate', -1)"
    />
    <span
      v-if="pages !== undefined"
      class="preview-controls__value"
      :aria-label="t('windows.pdfPage', { page })"
      ><span
        class="preview-controls__number preview-controls__page"
        :style="{ width: `calc(${String(pages).length}ch + 8px)` }"
        >{{ page }}</span
      >
      / {{ pages }}</span
    >
    <span v-if="pages !== undefined" class="preview-controls__divider" />
    <q-btn
      flat
      dense
      size="var(--control-size-compact)"
      icon="remove"
      :disable="scale <= PREVIEW_MIN_SCALE"
      :aria-label="t('windows.zoomOut')"
      @click="emit('zoom', -PREVIEW_SCALE_STEP)"
    />
    <span class="preview-controls__number preview-controls__scale"
      >{{ Math.round(scale * 100) }}%</span
    >
    <q-btn
      flat
      dense
      size="var(--control-size-compact)"
      icon="add"
      :disable="scale >= PREVIEW_MAX_SCALE"
      :aria-label="t('windows.zoomIn')"
      @click="emit('zoom', PREVIEW_SCALE_STEP)"
    />
    <span v-if="pages !== undefined" class="preview-controls__divider" />
    <span v-if="pages !== undefined" class="preview-controls__status">
      <q-spinner v-show="busy" size="11px" />
    </span>
    <q-btn
      flat
      dense
      size="var(--control-size-compact)"
      v-if="pages !== undefined"
      icon="chevron_right"
      :disable="!pages || page >= pages"
      :aria-label="t('windows.pdfNext')"
      @click="emit('navigate', 1)"
    />
  </div>
</template>

<style scoped>
.preview-controls {
  padding: 2px;
  border: 1px solid var(--window-divider);
  border-radius: 4px;
  background: var(--window-header-bg);
  box-shadow: 0 3px 12px rgb(0 0 0 / 25%);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  user-select: none;
}
.preview-controls__value {
  white-space: nowrap;
  padding: 0 2px;
}
.preview-controls__number {
  display: inline-block;
  padding: 1px 4px;
}
.preview-controls__page {
  text-align: center;
}
.preview-controls__status {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 19px;
}
.preview-controls__scale {
  min-width: 36px;
  text-align: center;
}
.preview-controls__divider {
  height: 12px;
  border-left: 1px solid var(--window-divider);
  margin: 0 2px;
}
</style>
