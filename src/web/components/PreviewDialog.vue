<script setup lang="ts">
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'
import { useI18n } from 'vue-i18n'

defineProps<{
  /** Shown in the header bar: a file name or path. */
  title: string
  /** `wide` fills most of the window (documents); `fit` hugs the content (images). */
  size?: 'wide' | 'fit'
}>()
const emit = defineEmits<{ (e: 'before-show'): void; (e: 'hide'): void }>()
const open = defineModel<boolean>({ required: true })

const { t } = useI18n()
</script>

<template>
  <q-dialog
    v-model="open"
    @before-show="emit('before-show')"
    @hide="emit('hide')"
  >
    <q-card
      bordered
      class="preview-dialog column no-wrap"
      :class="`preview-dialog--${size ?? 'fit'}`"
    >
      <div class="window-header row no-wrap items-center">
        <span class="window-header__title col ellipsis"
          >{{ title }}
          <q-tooltip :delay="TOOLTIP_DELAY_MS">{{ title }}</q-tooltip>
        </span>
        <q-btn
          v-close-popup
          flat
          dense
          size="sm"
          class="window-header__control"
          icon="close"
          :aria-label="t('changes.closePreview')"
        />
      </div>
      <div class="preview-dialog__body col">
        <slot />
      </div>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.preview-dialog {
  max-width: 94vw;
  max-height: 92vh;
  border: 1px solid var(--window-divider);
  overflow: hidden;
}
.preview-dialog--wide {
  width: 900px;
  height: 90vh;
}
.preview-dialog__body {
  min-height: 0;
  overflow: auto;
}
</style>
