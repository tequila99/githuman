<script setup lang="ts">
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
      <div class="preview-dialog__head row no-wrap items-center">
        <span class="preview-dialog__title ellipsis" :title="title">{{
          title
        }}</span>
        <q-space />
        <q-btn
          v-close-popup
          flat
          round
          dense
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
  border: 1px solid rgba(128, 128, 128, 0.55);
  overflow: hidden;
}
.preview-dialog--wide {
  width: 900px;
  height: 90vh;
}
/* A bar of its own, tinted like the diff headers, so the title can't be missed. */
.preview-dialog__head {
  flex: 0 0 auto;
  padding: 8px 8px 8px 16px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.55);
  background: var(--diff-header-bg);
}
.preview-dialog__title {
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
}
.preview-dialog__body {
  min-height: 0;
  overflow: auto;
}
</style>
