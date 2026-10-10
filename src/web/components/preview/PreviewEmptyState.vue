<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const emit = defineEmits<{ openFile: [] }>()
const { t } = useI18n()
</script>

<template>
  <div class="preview-empty column items-center justify-center q-pa-lg">
    <q-icon name="folder_open" size="48px" class="text-grey-6" />
    <div class="q-my-md text-grey-6">{{ t('windows.empty') }}</div>
    <q-btn
      outline
      color="primary"
      icon="folder_open"
      :label="t('windows.openFile')"
      @click="emit('openFile')"
    />
    <div class="q-mt-sm text-caption text-grey-6">{{
      t('windows.dropFiles')
    }}</div>
  </div>
</template>

<style scoped>
.preview-empty {
  flex: 1;
}
</style>
