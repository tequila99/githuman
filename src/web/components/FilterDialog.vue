<script setup lang="ts">
import DialogHeader from '@/components/DialogHeader.vue'
import { useI18n } from 'vue-i18n'
import { useAppTheme } from '@/composables/use-app-theme'

const open = defineModel<boolean>({ required: true })
defineProps<{ canReset: boolean; width?: string }>()
defineEmits<{ prepare: []; reset: []; apply: [] }>()
const { t } = useI18n()
const { isDark } = useAppTheme()
</script>

<template>
  <q-dialog v-model="open" @before-show="$emit('prepare')">
    <q-card :dark="isDark" class="filter-dialog" :style="{ width }">
      <DialogHeader
        :title="t('common.filters.title')"
        :close-label="t('common.filters.close')"
      />
      <q-card-section class="filter-dialog__fields scroll column q-gutter-sm">
        <slot />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn
          flat
          :label="t('common.filters.reset')"
          :disable="!canReset"
          @click="$emit('reset')"
        />
        <q-btn
          flat
          color="primary"
          :label="t('common.filters.done')"
          @click="$emit('apply')"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.q-card.filter-dialog {
  width: 420px;
  max-width: 90vw;
  font-family: var(--font-agent);
}
.filter-dialog__fields {
  max-height: 55vh;
  flex-wrap: nowrap;
}
.filter-dialog__fields > :deep(*) {
  flex-shrink: 0;
}
</style>
